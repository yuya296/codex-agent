import prompts from 'prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG_PATH } from '../config/index.js';
import {
  buildSetupConfig,
  shouldOverwrite,
  validateOptionalPortText,
  validateRequiredText,
  validateSlackAppToken,
  validateSlackBotToken,
  writeConfigToml,
} from './setup-lib.js';

async function runSetup(): Promise<void> {
  const configPath = DEFAULT_CONFIG_PATH;

  if (shouldOverwrite(configPath)) {
    const overwriteAnswer = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: `config already exists at ${configPath}. overwrite?`,
      initial: false,
    });

    if (!overwriteAnswer.overwrite) {
      // eslint-disable-next-line no-console
      console.log('setup cancelled (existing config kept)');
      return;
    }
  }

  const defaultCodexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');

  const answers = await prompts(
    [
      {
        type: 'password',
        name: 'slackBotToken',
        message: 'SLACK_BOT_TOKEN',
        validate: validateSlackBotToken,
      },
      {
        type: 'password',
        name: 'slackAppToken',
        message: 'SLACK_APP_TOKEN',
        validate: validateSlackAppToken,
      },
      {
        type: 'text',
        name: 'codexHome',
        message: 'CODEX_HOME',
        initial: defaultCodexHome,
        validate: (value: string) => validateRequiredText(value, 'CODEX_HOME'),
      },
      {
        type: 'text',
        name: 'workerCommand',
        message: 'CODEX_WORKER_COMMAND',
        initial: 'codex',
        validate: (value: string) => validateRequiredText(value, 'CODEX_WORKER_COMMAND'),
      },
      {
        type: 'text',
        name: 'workerArgsText',
        message: 'CODEX_WORKER_ARGS',
        initial: 'app-server',
        validate: (value: string) => validateRequiredText(value, 'CODEX_WORKER_ARGS'),
      },
      {
        type: 'confirm',
        name: 'slackAgentChatStatusEnabled',
        message: 'SLACK_AGENT_CHAT_STATUS_ENABLED',
        initial: false,
      },
      {
        type: 'text',
        name: 'workerCwd',
        message: 'CODEX_WORKER_CWD (optional)',
      },
      {
        type: 'text',
        name: 'sqlitePath',
        message: 'SQLITE_PATH',
        initial: './data/app.sqlite',
        validate: (value: string) => validateRequiredText(value, 'SQLITE_PATH'),
      },
      {
        type: 'text',
        name: 'portText',
        message: 'PORT (optional)',
        validate: validateOptionalPortText,
      },
    ],
    {
      onCancel: () => true,
    },
  );

  if (!answers.slackBotToken || !answers.slackAppToken) {
    // eslint-disable-next-line no-console
    console.error('setup cancelled');
    process.exitCode = 1;
    return;
  }

  const config = buildSetupConfig({
    slackBotToken: answers.slackBotToken,
    slackAppToken: answers.slackAppToken,
    codexHome: answers.codexHome,
    workerCommand: answers.workerCommand,
    workerArgsText: answers.workerArgsText,
    slackAgentChatStatusEnabled: answers.slackAgentChatStatusEnabled,
    workerCwd: answers.workerCwd,
    sqlitePath: answers.sqlitePath,
    portText: answers.portText,
  });

  writeConfigToml(configPath, config);

  // eslint-disable-next-line no-console
  console.log(`wrote config to ${configPath}`);
}

void runSetup().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`setup failed: ${String(error)}`);
  process.exitCode = 1;
});
