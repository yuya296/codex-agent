import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import TOML from '@iarna/toml';

export interface SetupInput {
  slackBotToken: string;
  slackAppToken: string;
  codexHome: string;
  workerCommand: string;
  workerArgsText: string;
  slackAgentChatStatusEnabled?: boolean;
  workerCwd?: string;
  sqlitePath: string;
  portText?: string;
}

export interface SetupConfigToml {
  slack: {
    bot_token: string;
    app_token: string;
  };
  codex: {
    home: string;
    worker_command: string;
    worker_args: string[];
    worker_cwd?: string;
  };
  app: {
    sqlite_path: string;
    slack_agent_chat_status_enabled: boolean;
    port?: number;
  };
}

export function buildSetupConfig(input: SetupInput): SetupConfigToml {
  const port = parsePortText(input.portText);

  return {
    slack: {
      bot_token: input.slackBotToken,
      app_token: input.slackAppToken,
    },
    codex: {
      home: input.codexHome,
      worker_command: input.workerCommand,
      worker_args: parseWorkerArgsText(input.workerArgsText),
      worker_cwd: normalizeOptionalText(input.workerCwd),
    },
    app: {
      sqlite_path: input.sqlitePath,
      slack_agent_chat_status_enabled: input.slackAgentChatStatusEnabled ?? false,
      port,
    },
  };
}

export function parseWorkerArgsText(input: string): string[] {
  return input.split(/\s+/).filter(Boolean);
}

export function validateSlackBotToken(value: string): true | string {
  if (!value) {
    return 'SLACK_BOT_TOKEN is required';
  }
  if (!value.startsWith('xoxb-')) {
    return 'SLACK_BOT_TOKEN must start with xoxb-';
  }
  return true;
}

export function validateSlackAppToken(value: string): true | string {
  if (!value) {
    return 'SLACK_APP_TOKEN is required';
  }
  if (!value.startsWith('xapp-')) {
    return 'SLACK_APP_TOKEN must start with xapp-';
  }
  return true;
}

export function validateRequiredText(value: string, keyName: string): true | string {
  if (!value || value.trim() === '') {
    return `${keyName} is required`;
  }
  return true;
}

export function validateOptionalPortText(value: string): true | string {
  if (!value || value.trim() === '') {
    return true;
  }

  const asNumber = Number(value);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    return 'PORT must be a positive integer';
  }

  return true;
}

export function parsePortText(value?: string): number | undefined {
  if (!value || value.trim() === '') {
    return undefined;
  }

  const asNumber = Number(value);
  if (!Number.isInteger(asNumber) || asNumber <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return asNumber;
}

export function writeConfigToml(filePath: string, config: SetupConfigToml): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  const toml = TOML.stringify(config as any);
  writeFileSync(filePath, toml, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function shouldOverwrite(path: string): boolean {
  return existsSync(path);
}

function normalizeOptionalText(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
