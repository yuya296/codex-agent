import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway, toSlackLoadingMessage, type SlackPublisher } from '../src/gateway/gateway.js';

function createSession() {
  return {
    session_id: 'S1',
    slack_team_id: 'T1',
    slack_channel_id: 'D1',
    slack_root_thread_ts: '100.1',
    codex_thread_id: 'thread-1',
    state: 'running' as const,
    pending_approval_id: null,
    created_at: '2026-03-20T00:00:00.000Z',
    updated_at: '2026-03-20T00:00:00.000Z',
  };
}

test('toSlackLoadingMessage: collapses whitespace and truncates to 50 chars', () => {
  const loading = toSlackLoadingMessage(
    '`playwright-cli` という名前の実体があるかを、そのコマンド名で直接確認します。\n権限制約があります。',
  );

  assert.equal(loading.length <= 50, true);
  assert.equal(loading.includes('\n'), false);
  assert.match(loading, /…$/);
});

test('notifyProgress: status update failure does not throw', async () => {
  const publisher: SlackPublisher = {
    postThreadMessage: async () => {},
    setThreadStatus: async () => {
      throw new Error('invalid_arguments');
    },
  };
  const gateway = new Gateway({} as any, publisher);

  await assert.doesNotReject(() => gateway.notifyProgress(createSession(), 'long progress message'));
});
