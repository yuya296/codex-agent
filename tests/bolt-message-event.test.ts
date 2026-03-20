import test from 'node:test';
import assert from 'node:assert/strict';
import { toSlackMessageEvent } from '../src/gateway/bolt.js';

test('toSlackMessageEvent maps threaded dm payload', () => {
  assert.deepEqual(
    toSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      parent_user_id: 'U2',
      channel_type: 'im',
    }),
    {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      parent_user_id: 'U2',
      assistant_thread: undefined,
      channel_type: 'im',
      subtype: undefined,
    },
  );
});

test('toSlackMessageEvent returns null when required fields are missing', () => {
  assert.equal(
    toSlackMessageEvent({
      channel: 'D1',
      text: 'hello',
      ts: '100.2',
      channel_type: 'im',
    }),
    null,
  );
});
