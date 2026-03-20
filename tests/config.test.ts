import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFromEnv } from '../src/config/index.js';

test('loadConfigFromEnv: reads config from env and expands home paths', () => {
  const loaded = loadConfigFromEnv({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    CODEX_HOME: '~/.codex',
    CODEX_WORKER_COMMAND: 'codex',
    CODEX_WORKER_ARGS: 'app-server --listen stdio://',
    CODEX_WORKER_CWD: '~/workspace',
    WORKER_STREAM_EVENT_TIMEOUT_MS: '600000',
    SQLITE_PATH: '~/data/app.sqlite',
    SLACK_AGENT_CHAT_STATUS_ENABLED: 'true',
    PORT: '3000',
  });

  assert.equal(loaded.slackBotToken, 'xoxb-test');
  assert.equal(loaded.slackAppToken, 'xapp-test');
  assert.equal(loaded.codexHome, join(homedir(), '.codex'));
  assert.deepEqual(loaded.workerArgs, ['app-server', '--listen', 'stdio://']);
  assert.equal(loaded.workerCwd, join(homedir(), 'workspace'));
  assert.equal(loaded.workerStreamEventTimeoutMs, 600000);
  assert.equal(loaded.sqlitePath, join(homedir(), 'data', 'app.sqlite'));
  assert.equal(loaded.slackAgentChatStatusEnabled, true);
  assert.equal(loaded.port, 3000);
});

test('loadConfigFromEnv: applies defaults for optional values', () => {
  const loaded = loadConfigFromEnv({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
  });

  assert.equal(loaded.codexHome, join(homedir(), '.codex'));
  assert.equal(loaded.workerCommand, 'codex');
  assert.deepEqual(loaded.workerArgs, ['app-server']);
  assert.equal(loaded.sqlitePath, './data/app.sqlite');
  assert.equal(loaded.workerStreamEventTimeoutMs, 300000);
  assert.equal(loaded.slackAgentChatStatusEnabled, false);
});

test('loadConfigFromEnv: throws helpful message when required env is missing', () => {
  assert.throws(() => loadConfigFromEnv({}), /SLACK_BOT_TOKEN is required/);
});
