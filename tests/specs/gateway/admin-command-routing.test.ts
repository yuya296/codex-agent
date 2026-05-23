import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../../../src/gateway/gateway.js';
import { MockGatewayThread, MockWorkerClient } from '../../support/helpers.js';

test('gateway routing answers admin commands through the admin command handler', async () => {
  const thread = new MockGatewayThread();
  const gateway = new Gateway(
    new MockWorkerClient(),
    {
      execute: async () => 'Status\n- Codex CLI: codex-cli 0.116.0',
    },
  );

  await gateway.handleMessage(thread as any, {
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: ' /status',
    ts: '500.1',
    channel_type: 'im',
  });

  assert.deepEqual(thread.postCalls, ['Status\n- Codex CLI: codex-cli 0.116.0']);
  assert.deepEqual(thread.setStateCalls, []);
});
