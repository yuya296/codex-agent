import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Gateway,
  toSlackLoadingMessage,
  toSlackMrkdwn,
  type SlackPublisher,
} from '../src/gateway/gateway.js';

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

test('toSlackMrkdwn: converts markdown to mrkdwn using md-to-slack behavior', () => {
  const converted = toSlackMrkdwn(
    [
      '# Heading',
      '',
      '- **bold** item',
      '- [example](https://example.com)',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n'),
  );

  assert.equal(converted.includes('# Heading'), false);
  assert.match(converted, /\*bold\*/);
  assert.match(converted, /<https:\/\/example\.com\|example>/);
  assert.match(converted, /```/);
});

test('notifyCompleted: converts markdown before posting thread message', async () => {
  const posted: Array<{ text: string }> = [];
  const publisher: SlackPublisher = {
    postThreadMessage: async (input) => {
      posted.push({ text: input.text });
    },
    setThreadStatus: async () => {},
  };
  const gateway = new Gateway({} as any, publisher);

  await gateway.notifyCompleted(
    createSession(),
    ['# Heading', '', '- **bold** item', '- [example](https://example.com)'].join('\n'),
  );

  assert.equal(posted.length, 1);
  assert.equal(posted[0]?.text.includes('# Heading'), false);
  assert.match(posted[0]?.text ?? '', /\*bold\*/);
  assert.match(posted[0]?.text ?? '', /<https:\/\/example\.com\|example>/);
});
