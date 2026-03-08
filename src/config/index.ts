import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import TOML from '@iarna/toml';

export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  codexHome: string;
  sqlitePath: string;
  workerCommand: string;
  workerArgs: string[];
  workerCwd?: string;
  port?: number;
}

interface ConfigToml {
  slack?: {
    bot_token?: unknown;
    app_token?: unknown;
  };
  codex?: {
    home?: unknown;
    worker_command?: unknown;
    worker_args?: unknown;
    worker_cwd?: unknown;
  };
  app?: {
    sqlite_path?: unknown;
    port?: unknown;
  };
}

export const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'codex-agent', 'config.toml');

export function loadConfigFromToml(filePath = DEFAULT_CONFIG_PATH): AppConfig {
  if (!existsSync(filePath)) {
    throw new Error(`config file not found: ${filePath}. Run 'npm run setup' first.`);
  }

  const raw = readFileSync(filePath, 'utf8');

  let parsed: ConfigToml;
  try {
    parsed = TOML.parse(raw) as ConfigToml;
  } catch (error) {
    throw new Error(`failed to parse config.toml: ${String(error)}`);
  }

  const slackBotToken = readRequiredString(parsed.slack?.bot_token, 'slack.bot_token');
  const slackAppToken = readRequiredString(parsed.slack?.app_token, 'slack.app_token');
  const codexHome = expandHome(readRequiredString(parsed.codex?.home, 'codex.home'));
  const workerCommand = readRequiredString(parsed.codex?.worker_command, 'codex.worker_command');
  const workerArgs = parseWorkerArgs(parsed.codex?.worker_args);
  const workerCwd = readOptionalString(parsed.codex?.worker_cwd, 'codex.worker_cwd');
  const sqlitePath = expandHome(readRequiredString(parsed.app?.sqlite_path, 'app.sqlite_path'));
  const port = parsePort(parsed.app?.port);

  return {
    slackBotToken,
    slackAppToken,
    codexHome,
    sqlitePath,
    workerCommand,
    workerArgs,
    workerCwd: workerCwd ? expandHome(workerCwd) : undefined,
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

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('app.port must be a positive integer when provided');
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
