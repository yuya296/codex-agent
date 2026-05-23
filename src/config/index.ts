import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppConfig {
  slackBotToken: string;
  slackAppToken: string;
  slackBotUserName: string;
  codexHome: string;
  redisUrl: string;
  slackAgentChatStatusEnabled: boolean;
  workerCommand: string;
  workerArgs: string[];
  workerCwd?: string;
  workerStreamEventTimeoutMs: number;
  slackAttachmentMaxBytes: number;
  slackAttachmentTmpDir?: string;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  assertRemovedConfig(
    env.SESSION_MIGRATION_SQLITE_PATH,
    'SESSION_MIGRATION_SQLITE_PATH is no longer supported. This version does not migrate sqlite sessions; remove the variable and expect in-flight sessions and pending approvals to reset when upgrading.',
  );
  const slackBotToken = readRequiredString(env.SLACK_BOT_TOKEN, 'SLACK_BOT_TOKEN');
  const slackAppToken = readRequiredString(env.SLACK_APP_TOKEN, 'SLACK_APP_TOKEN');
  const slackBotUserName = env.SLACK_BOT_USERNAME?.trim() || 'codex-agent';
  const codexHome = expandHome(env.CODEX_HOME?.trim() || join(homedir(), '.codex'));
  const redisUrl = readRequiredString(env.REDIS_URL, 'REDIS_URL');
  const workerCommand = env.CODEX_WORKER_COMMAND?.trim() || 'codex';
  const workerArgs = parseWorkerArgs(env.CODEX_WORKER_ARGS ?? 'app-server');
  const workerCwd = readOptionalString(env.CODEX_WORKER_CWD, 'CODEX_WORKER_CWD');
  const workerStreamEventTimeoutMs = parsePositiveInteger(
    env.WORKER_STREAM_EVENT_TIMEOUT_MS,
    'WORKER_STREAM_EVENT_TIMEOUT_MS',
    5 * 60 * 1000,
  );
  const slackAttachmentMaxBytes = parsePositiveInteger(
    env.SLACK_ATTACHMENT_MAX_BYTES,
    'SLACK_ATTACHMENT_MAX_BYTES',
    10 * 1024 * 1024,
  );
  const slackAgentChatStatusEnabled = parseOptionalBoolean(
    env.SLACK_AGENT_CHAT_STATUS_ENABLED,
    'SLACK_AGENT_CHAT_STATUS_ENABLED',
    false,
  );
  const slackAttachmentTmpDir = readOptionalString(
    env.SLACK_ATTACHMENT_TMP_DIR,
    'SLACK_ATTACHMENT_TMP_DIR',
  );

  return {
    slackBotToken,
    slackAppToken,
    slackBotUserName,
    codexHome,
    redisUrl,
    slackAgentChatStatusEnabled,
    workerCommand,
    workerArgs,
    workerCwd: workerCwd ? expandHome(workerCwd) : undefined,
    workerStreamEventTimeoutMs,
    slackAttachmentMaxBytes,
    slackAttachmentTmpDir: slackAttachmentTmpDir ? expandHome(slackAttachmentTmpDir) : undefined,
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

  throw new Error(`${fieldName} must be boolean when provided`);
}

function assertRemovedConfig(value: unknown, message: string): void {
  if (value === undefined || value === null || value === '') {
    return;
  }

  throw new Error(message);
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
