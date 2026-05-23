import { spawnSync } from 'node:child_process';
import { runDoctorChecks, summarizeResults, type CheckResult } from '../cli/doctor-lib.js';

export type AdminCommandName =
  | 'help'
  | 'status'
  | 'doctor'
  | 'worker-restart'
  | 'codex-check-update';

export interface ParsedAdminCommand {
  name: AdminCommandName;
}

export interface AdminCommandContext {
  processUptimeSeconds: number;
  codexHome: string;
  redisUrl: string;
  workerCommand: string;
  workerArgs: string[];
  workerCwd?: string;
  slackAgentChatStatusEnabled: boolean;
}

export interface AdminCommandHandler {
  execute(command: ParsedAdminCommand): Promise<string>;
}

export interface AdminCommandDeps {
  getStatusContext(): Promise<AdminCommandContext> | AdminCommandContext;
  restartWorker(): Promise<void>;
  getCodexVersion(): Promise<string>;
  getLatestCodexVersion(): Promise<string | null>;
  runDoctor(): Promise<CheckResult[]>;
}

const HELP_TEXT = [
  'Available commands:',
  '/help',
  '/status',
  '/doctor',
  '/worker-restart',
  '/codex-check-update',
].join('\n');

export function parseAdminCommand(text: string): ParsedAdminCommand | null {
  const normalized = text.trimStart();
  if (!normalized.startsWith('/')) {
    return null;
  }

  const [rawCommand] = normalized.split(/\s+/, 1);
  const command = rawCommand?.toLowerCase();
  switch (command) {
    case '/help':
      return { name: 'help' };
    case '/status':
      return { name: 'status' };
    case '/doctor':
      return { name: 'doctor' };
    case '/worker-restart':
      return { name: 'worker-restart' };
    case '/codex-check-update':
      return { name: 'codex-check-update' };
    default:
      return null;
  }
}

export function createAdminCommandHandler(deps: AdminCommandDeps): AdminCommandHandler {
  return {
    execute: async (command) => {
      switch (command.name) {
        case 'help':
          return wrapCodeBlock(HELP_TEXT);
        case 'status':
          return wrapCodeBlock(formatStatus(await deps.getStatusContext(), await deps.getCodexVersion()));
        case 'doctor':
          return wrapCodeBlock(formatDoctor(await deps.runDoctor()));
        case 'worker-restart':
          await deps.restartWorker();
          return wrapCodeBlock('Worker restarted.');
        case 'codex-check-update':
          return wrapCodeBlock(
            formatCodexUpdate(await deps.getCodexVersion(), await deps.getLatestCodexVersion()),
          );
      }
    },
  };
}

export async function getCodexVersion(command = 'codex'): Promise<string> {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    return 'unavailable';
  }

  return firstNonEmptyLine(result.stdout) ?? 'unavailable';
}

export async function getLatestCodexVersion(): Promise<string | null> {
  const env = {
    ...process.env,
    npm_config_cache: '/tmp/codex-agent-npm-cache',
  };
  const result = spawnSync('npm', ['view', '@openai/codex', 'version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return firstNonEmptyLine(result.stdout) ?? null;
}

export async function runAdminDoctor(cwd?: string): Promise<CheckResult[]> {
  return runDoctorChecks(cwd);
}

function formatStatus(context: AdminCommandContext, codexVersion: string): string {
  const workerCommand = [context.workerCommand, ...context.workerArgs].join(' ').trim();

  return [
    'Status',
    `- Codex CLI: ${codexVersion}`,
    `- Worker command: ${workerCommand || 'unknown'}`,
    `- Worker cwd: ${context.workerCwd ?? process.cwd()}`,
    `- CODEX_HOME: ${context.codexHome}`,
    `- Redis: ${context.redisUrl}`,
    '- Slack connection: socket',
    `- Agent chat status: ${context.slackAgentChatStatusEnabled ? 'enabled' : 'disabled'}`,
    `- Uptime: ${Math.floor(context.processUptimeSeconds)}s`,
  ].join('\n');
}

function formatDoctor(results: CheckResult[]): string {
  const summary = summarizeResults(results);
  const lines = [
    'Doctor',
    `- ok: ${summary.ok}`,
    `- warn: ${summary.warn}`,
    `- fail: ${summary.fail}`,
    '',
  ];

  for (const result of results) {
    lines.push(`- [${result.status.toUpperCase()}] ${result.label}: ${result.detail}`);
  }

  return lines.join('\n');
}

function formatCodexUpdate(installedVersion: string, latestVersion: string | null): string {
  const installedTag = extractVersionNumber(installedVersion);
  if (!latestVersion) {
    return [
      'Codex update check',
      `- Installed: ${installedVersion}`,
      '- Latest: unavailable',
      '- Note: npm registry lookup failed.',
    ].join('\n');
  }

  const updateAvailable = installedTag ? installedTag !== latestVersion : installedVersion !== latestVersion;
  return [
    'Codex update check',
    `- Installed: ${installedVersion}`,
    `- Latest: ${latestVersion}`,
    `- Update available: ${updateAvailable ? 'yes' : 'no'}`,
    updateAvailable
      ? '- Docker note: rebuild the image after updating.'
      : '- Docker note: no rebuild is needed right now.',
  ].join('\n');
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function extractVersionNumber(text: string): string | null {
  const match = text.match(/(\d+\.\d+\.\d+)/u);
  return match?.[1] ?? null;
}

function wrapCodeBlock(text: string): string {
  return ['```', text, '```'].join('\n');
}
