import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFromEnv } from '../../../src/config/index.js';

test('config loading rejects the removed sqlite migration env with a clear message', () => {
  assert.throws(() => loadConfigFromEnv({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    REDIS_URL: 'redis://localhost:6379',
    SLACK_BOT_USERNAME: 'codex-agent-dev',
    CODEX_HOME: '~/.codex',
    SESSION_MIGRATION_SQLITE_PATH: '~/data/app.sqlite',
    CODEX_WORKER_COMMAND: 'codex',
    CODEX_WORKER_ARGS: 'app-server --listen stdio://',
    CODEX_WORKER_CWD: '~/workspace',
    WORKER_STREAM_EVENT_TIMEOUT_MS: '600000',
    SLACK_AGENT_CHAT_STATUS_ENABLED: 'true',
  }), /SESSION_MIGRATION_SQLITE_PATH is no longer supported/);
});

test('config loading falls back to defaults when optional values are omitted', () => {
  const loaded = loadConfigFromEnv({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    REDIS_URL: 'redis://localhost:6379',
  });

  assert.equal(loaded.slackAppToken, 'xapp-test');
  assert.equal(loaded.codexHome, join(homedir(), '.codex'));
  assert.equal(loaded.slackBotUserName, 'codex-agent');
  assert.equal(loaded.workerCommand, 'codex');
  assert.deepEqual(loaded.workerArgs, ['app-server']);
  assert.equal(loaded.redisUrl, 'redis://localhost:6379');
  assert.equal(loaded.workerStreamEventTimeoutMs, 300000);
  assert.equal(loaded.slackAgentChatStatusEnabled, false);
});

test('config loading requires a Slack app token', () => {
  assert.throws(
    () =>
      loadConfigFromEnv({
        SLACK_BOT_TOKEN: 'xoxb-test',
        REDIS_URL: 'redis://localhost:6379',
      }),
    /SLACK_APP_TOKEN is required/,
  );
});

test('config loading fails with a helpful message when required variables are missing', () => {
  assert.throws(() => loadConfigFromEnv({}), /SLACK_BOT_TOKEN is required/);
});

test('config loading rejects invalid boolean values when parsing environment variables', () => {
  assert.throws(
    () =>
      loadConfigFromEnv({
        SLACK_BOT_TOKEN: 'xoxb-test',
        SLACK_APP_TOKEN: 'xapp-test',
        REDIS_URL: 'redis://localhost:6379',
        SLACK_AGENT_CHAT_STATUS_ENABLED: 'yes',
      }),
    /SLACK_AGENT_CHAT_STATUS_ENABLED must be boolean when provided/,
  );
});
