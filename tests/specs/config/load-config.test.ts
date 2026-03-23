import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFromEnv } from '../../../src/config/index.js';

test('config loading uses explicit environment values and expands home paths when variables are provided', () => {
  const loaded = loadConfigFromEnv({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_SIGNING_SECRET: 'signing-secret',
    REDIS_URL: 'redis://localhost:6379',
    SLACK_BOT_USERNAME: 'codex-agent-dev',
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
  assert.equal(loaded.slackSigningSecret, 'signing-secret');
  assert.equal(loaded.slackBotUserName, 'codex-agent-dev');
  assert.equal(loaded.codexHome, join(homedir(), '.codex'));
  assert.equal(loaded.redisUrl, 'redis://localhost:6379');
  assert.deepEqual(loaded.workerArgs, ['app-server', '--listen', 'stdio://']);
  assert.equal(loaded.workerCwd, join(homedir(), 'workspace'));
  assert.equal(loaded.workerStreamEventTimeoutMs, 600000);
  assert.equal(loaded.sqlitePath, join(homedir(), 'data', 'app.sqlite'));
  assert.equal(loaded.slackAgentChatStatusEnabled, true);
  assert.equal(loaded.port, 3000);
});

test('config loading falls back to defaults when optional values are omitted', () => {
  const loaded = loadConfigFromEnv({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_SIGNING_SECRET: 'signing-secret',
    REDIS_URL: 'redis://localhost:6379',
  });

  assert.equal(loaded.codexHome, join(homedir(), '.codex'));
  assert.equal(loaded.slackBotUserName, 'codex-agent');
  assert.equal(loaded.workerCommand, 'codex');
  assert.deepEqual(loaded.workerArgs, ['app-server']);
  assert.equal(loaded.redisUrl, 'redis://localhost:6379');
  assert.equal(loaded.sqlitePath, './data/app.sqlite');
  assert.equal(loaded.workerStreamEventTimeoutMs, 300000);
  assert.equal(loaded.slackAgentChatStatusEnabled, false);
});

test('config loading fails with a helpful message when required variables are missing', () => {
  assert.throws(() => loadConfigFromEnv({}), /SLACK_BOT_TOKEN is required/);
});

test('config loading rejects invalid boolean values when parsing environment variables', () => {
  assert.throws(
    () =>
      loadConfigFromEnv({
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_SIGNING_SECRET: 'signing-secret',
        REDIS_URL: 'redis://localhost:6379',
        SLACK_AGENT_CHAT_STATUS_ENABLED: 'yes',
      }),
    /SLACK_AGENT_CHAT_STATUS_ENABLED must be boolean when provided/,
  );
});
