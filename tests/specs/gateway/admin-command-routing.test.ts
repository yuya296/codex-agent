import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway, type SlackPublisher } from '../../../src/gateway/gateway.js';

test('gateway routing answers admin commands without starting or continuing a session', async () => {
  const calls: string[] = [];
  const posted: Array<{ root_thread_ts: string; text: string }> = [];

  const gateway = new Gateway(
    {
      startSession: async () => {
        calls.push('start');
        throw new Error('should not be called');
      },
      continueSession: async () => {
        calls.push('continue');
        throw new Error('should not be called');
      },
      resolveApproval: async () => {},
    } as any,
    {
      postThreadMessage: async (input) => {
        posted.push({ root_thread_ts: input.root_thread_ts, text: input.text });
      },
      uploadThreadFiles: async () => {},
      setThreadStatus: async () => {},
    } satisfies SlackPublisher,
    {
      execute: async () => 'Status\n- Codex CLI: codex-cli 0.116.0',
    },
  );

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: ' /status',
    ts: '500.1',
    channel_type: 'im',
  });

  assert.deepEqual(calls, []);
  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.root_thread_ts, '500.1');
  assert.match(posted[0]?.text ?? '', /^Status/m);
});
