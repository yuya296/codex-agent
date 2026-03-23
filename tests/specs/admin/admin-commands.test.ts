import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminCommandHandler,
  parseAdminCommand,
} from '../../../src/admin/commands.js';

test('admin commands accept slash command syntax even when the input starts with leading whitespace', () => {
  assert.deepEqual(parseAdminCommand(' /help'), { name: 'help' });
  assert.deepEqual(parseAdminCommand('/status'), { name: 'status' });
  assert.deepEqual(parseAdminCommand('  /worker-restart now'), { name: 'worker-restart' });
  assert.equal(parseAdminCommand('hello'), null);
});

test('admin commands render help and status responses as operator-facing English text', async () => {
  const handler = createAdminCommandHandler({
    getStatusContext: async () => ({
      processUptimeSeconds: 12.7,
      codexHome: '/root/.codex',
      redisUrl: 'redis://redis:6379',
      sqlitePath: '/data/app.sqlite',
      workerCommand: 'codex',
      workerArgs: ['app-server'],
      workerCwd: '/app',
      slackAgentChatStatusEnabled: true,
    }),
    restartWorker: async () => {},
    getCodexVersion: async () => 'codex-cli 0.116.0',
    getLatestCodexVersion: async () => '0.116.0',
    runDoctor: async () => [
      { id: 'codex', label: 'codex CLI', status: 'ok', detail: 'version: codex-cli 0.116.0' },
    ],
  });

  const help = await handler.execute({ name: 'help' });
  assert.match(help, /^```\nAvailable commands:/);
  assert.match(help, /\/worker-restart/);
  assert.match(help, /```$/);

  const status = await handler.execute({ name: 'status' });
  assert.match(status, /^```\nStatus/m);
  assert.match(status, /Codex CLI: codex-cli 0.116.0/);
  assert.match(status, /Worker command: codex app-server/);
  assert.match(status, /Redis: redis:\/\/redis:6379/);
  assert.match(status, /Agent chat status: enabled/);
  assert.match(status, /```$/);
});
