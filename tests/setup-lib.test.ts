import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { buildSetupConfig, parsePortText, parseWorkerArgsText, validateOptionalPortText, validateSlackAppToken, validateSlackBotToken, writeConfigToml } from '../src/cli/setup-lib.js';
import { cleanupDir, createTempDir } from './helpers.js';

test('setup-lib: token validators should enforce prefixes', () => {
  assert.equal(validateSlackBotToken('xoxb-abc'), true);
  assert.notEqual(validateSlackBotToken('abc'), true);
  assert.equal(validateSlackAppToken('xapp-abc'), true);
  assert.notEqual(validateSlackAppToken('abc'), true);
});

test('setup-lib: parseWorkerArgsText splits by whitespace', () => {
  assert.deepEqual(parseWorkerArgsText('app-server   --listen   stdio://'), [
    'app-server',
    '--listen',
    'stdio://',
  ]);
});

test('setup-lib: optional port validation and parse', () => {
  assert.equal(validateOptionalPortText(''), true);
  assert.equal(validateOptionalPortText('3000'), true);
  assert.notEqual(validateOptionalPortText('-1'), true);
  assert.equal(parsePortText(''), undefined);
  assert.equal(parsePortText('8080'), 8080);
  assert.throws(() => parsePortText('0'));
});

test('setup-lib: build config should normalize optional fields', () => {
  const config = buildSetupConfig({
    slackBotToken: 'xoxb-test',
    slackAppToken: 'xapp-test',
    codexHome: '/tmp/.codex',
    workerCommand: 'codex',
    workerArgsText: 'app-server --listen stdio://',
    slackAgentChatStatusEnabled: true,
    workerCwd: '   ',
    sqlitePath: './data/app.sqlite',
    portText: '3000',
  });

  assert.deepEqual(config.codex.worker_args, ['app-server', '--listen', 'stdio://']);
  assert.equal(config.codex.worker_cwd, undefined);
  assert.equal(config.app.slack_agent_chat_status_enabled, true);
  assert.equal(config.app.port, 3000);
});

test('setup-lib: writeConfigToml should persist with mode 0600', () => {
  const tempDir = createTempDir();
  const filePath = join(tempDir, 'cfg', 'config.toml');

  writeConfigToml(filePath, {
    slack: { bot_token: 'xoxb-test', app_token: 'xapp-test' },
    codex: {
      home: '/tmp/.codex',
      worker_command: 'codex',
      worker_args: ['app-server'],
    },
    app: {
      sqlite_path: './data/app.sqlite',
      slack_agent_chat_status_enabled: false,
    },
  });

  const mode = statSync(filePath).mode & 0o777;
  assert.equal(mode, 0o600);

  cleanupDir(tempDir);
});
