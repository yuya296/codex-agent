import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  codexHome: string;
  sqlitePath: string;
  slackAgentChatStatusEnabled: boolean;
  workerCommand: string;
  workerArgs: string[];
  workerCwd?: string;
  workerStreamEventTimeoutMs: number;
  port?: number;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const slackBotToken = readRequiredString(env.SLACK_BOT_TOKEN, 'SLACK_BOT_TOKEN');
  const slackAppToken = readRequiredString(env.SLACK_APP_TOKEN, 'SLACK_APP_TOKEN');
  const codexHome = expandHome(env.CODEX_HOME?.trim() || join(homedir(), '.codex'));
  const workerCommand = env.CODEX_WORKER_COMMAND?.trim() || 'codex';
  const workerArgs = parseWorkerArgs(env.CODEX_WORKER_ARGS ?? 'app-server');
  const workerCwd = readOptionalString(env.CODEX_WORKER_CWD, 'CODEX_WORKER_CWD');
  const workerStreamEventTimeoutMs = parsePositiveInteger(
    env.WORKER_STREAM_EVENT_TIMEOUT_MS,
    'WORKER_STREAM_EVENT_TIMEOUT_MS',
    5 * 60 * 1000,
  );
  const sqlitePath = expandHome(env.SQLITE_PATH?.trim() || './data/app.sqlite');
  const slackAgentChatStatusEnabled = parseOptionalBoolean(
    env.SLACK_AGENT_CHAT_STATUS_ENABLED,
    'SLACK_AGENT_CHAT_STATUS_ENABLED',
    false,
  );
  const port = parsePort(env.PORT);

  return {
    slackBotToken,
    slackAppToken,
    codexHome,
    sqlitePath,
    slackAgentChatStatusEnabled,
    workerCommand,
    workerArgs,
    workerCwd: workerCwd ? expandHome(workerCwd) : undefined,
    workerStreamEventTimeoutMs,
    port,
  };
}

export function parseWorkerArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry !== 'string') {
        throw new Error(`codex.worker_args[${index}] must be string`);
      }
      return entry;
    });
  }

  if (typeof value === 'string') {
    return value.split(/\s+/).filter(Boolean);
  }

  throw new Error('codex.worker_args must be a string array or a whitespace separated string');
}

export function expandHome(input: string): string {
  if (input === '~') {
    return homedir();
  }

  if (input.startsWith('~/')) {
    return join(homedir(), input.slice(2));
  }

  return input;
}

function parsePort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error('PORT must be a positive integer when provided');
  }

  return asNumber;
}

function parsePositiveInteger(value: unknown, fieldName: string, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const asNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error(`${fieldName} must be a positive integer when provided`);
  }

  return asNumber;
}

function parseOptionalBoolean(value: unknown, fieldName: string, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be boolean when provided`);
  }

  return value;
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required and must be non-empty string`);
  }

  return value;
}

function readOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be string when provided`);
  }

  return value;
}
