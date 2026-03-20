import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { cleanupDir, createTempDir } from './helpers.js';
import { loadConfigFromToml } from '../src/config/index.js';

test('loadConfigFromToml: reads config and expands home paths', () => {
  const tempDir = createTempDir();
  const configPath = join(tempDir, 'config.toml');

  writeFileSync(
    configPath,
    [
      '[slack]',
      'bot_token = "xoxb-test"',
      'app_token = "xapp-test"',
      '',
      '[codex]',
      'home = "~/.codex"',
      'worker_command = "codex"',
      'worker_args = ["app-server", "--listen", "stdio://"]',
      'worker_cwd = "~/workspace"',
      '',
      '[app]',
      'sqlite_path = "~/data/app.sqlite"',
      'slack_agent_chat_status_enabled = true',
      'port = 3000',
      '',
    ].join('\n'),
  );

  const loaded = loadConfigFromToml(configPath);
  assert.equal(loaded.slackBotToken, 'xoxb-test');
  assert.equal(loaded.slackAppToken, 'xapp-test');
  assert.equal(loaded.codexHome, join(homedir(), '.codex'));
  assert.deepEqual(loaded.workerArgs, ['app-server', '--listen', 'stdio://']);
  assert.equal(loaded.workerCwd, join(homedir(), 'workspace'));
  assert.equal(loaded.sqlitePath, join(homedir(), 'data', 'app.sqlite'));
  assert.equal(loaded.slackAgentChatStatusEnabled, true);
  assert.equal(loaded.port, 3000);

  cleanupDir(tempDir);
});

test('loadConfigFromToml: accepts worker_args as string and splits it', () => {
  const tempDir = createTempDir();
  const configPath = join(tempDir, 'config.toml');

  writeFileSync(
    configPath,
    [
      '[slack]',
      'bot_token = "xoxb-test"',
      'app_token = "xapp-test"',
      '',
      '[codex]',
      'home = "/tmp/.codex"',
      'worker_command = "codex"',
      'worker_args = "app-server --listen stdio://"',
      '',
      '[app]',
      'sqlite_path = "./data/app.sqlite"',
      '',
    ].join('\n'),
  );

  const loaded = loadConfigFromToml(configPath);
  assert.deepEqual(loaded.workerArgs, ['app-server', '--listen', 'stdio://']);
  assert.equal(loaded.slackAgentChatStatusEnabled, false);

  cleanupDir(tempDir);
});

test('loadConfigFromToml: throws helpful message when file does not exist', () => {
  const tempDir = createTempDir();
  const configPath = join(tempDir, 'missing.toml');

  assert.throws(() => loadConfigFromToml(configPath), /Run 'npm run setup' first/);

  cleanupDir(tempDir);
});
