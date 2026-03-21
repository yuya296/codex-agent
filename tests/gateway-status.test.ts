import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLocalImageFiles,
  Gateway,
  renderSlackCompletedMessage,
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
    uploadThreadFiles: async () => {},
    setThreadStatus: async () => {
      throw new Error('invalid_arguments');
    },
  };
  const gateway = new Gateway({} as any, publisher);

  await assert.doesNotReject(() => gateway.notifyProgress(createSession(), 'long progress message'));
});

test('toSlackMrkdwn: preserves line structure and converts list/inline markdown for Slack', () => {
  const converted = toSlackMrkdwn(
    [
      '# Heading',
      '',
      '- **bold** item',
      '- [example](https://example.com)',
      '',
      '1. `npm test` を実行',
      '2. *結果* を確認',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n'),
  );

  assert.match(converted, /^# Heading/m);
  assert.match(converted, /\*bold\*/);
  assert.match(converted, /<https:\/\/example\.com\|example>/);
  assert.match(converted, /1\. `npm test` を実行/);
  assert.match(converted, /2\. _結果_ を確認/);
  assert.match(converted, /```/);
  assert.match(converted, /\* \*bold\* item/);
});

test('notifyCompleted: converts markdown before posting thread message', async () => {
  const posted: Array<{ text: string }> = [];
  const publisher: SlackPublisher = {
    postThreadMessage: async (input) => {
      posted.push({ text: input.text });
    },
    uploadThreadFiles: async () => {},
    setThreadStatus: async () => {},
  };
  const gateway = new Gateway({} as any, publisher);

  await gateway.notifyCompleted(
    createSession(),
    ['# Heading', '', '- **bold** item', '- [example](https://example.com)'].join('\n'),
  );

  assert.equal(posted.length, 1);
  assert.match(posted[0]?.text ?? '', /^# Heading/m);
  assert.match(posted[0]?.text ?? '', /\*bold\*/);
  assert.match(posted[0]?.text ?? '', /<https:\/\/example\.com\|example>/);
  assert.match(posted[0]?.text ?? '', /\* \*bold\* item/);
});

test('extractLocalImageFiles: strips markdown image syntax and bare local paths', () => {
  const path = join(tmpdir(), 'codex-agent-slack-image-test.png');
  writeFileSync(path, 'image');

  const extracted = extractLocalImageFiles(
    [
      'スクリーンショットはこちらです: ![weather](' + path + ')',
      '',
      '参考画像 ' + path,
    ].join('\n'),
  );

  assert.equal(extracted.images.length, 1);
  assert.equal(extracted.images[0]?.path, path);
  assert.equal(extracted.images[0]?.alt_text, 'weather');
  assert.equal(extracted.text.includes(path), false);
});

test('renderSlackCompletedMessage: posts text and image uploads separately', () => {
  const path = join(tmpdir(), 'codex-agent-slack-render-test.png');
  writeFileSync(path, 'image');

  const rendered = renderSlackCompletedMessage(
    ['# Heading', '', '- item', '', '画像です: ' + path].join('\n'),
  );

  assert.equal(rendered.images.length, 1);
  assert.equal(rendered.images[0]?.path, path);
  assert.equal(rendered.text.includes(path), false);
  assert.equal(rendered.text.includes('# Heading'), true);
  assert.match(rendered.text, /\* item/);
});

test('handleMessageEvent: file_share subtype is accepted and temporary directory is cleaned up', async () => {
  const tempPath = join(tmpdir(), `codex-agent-gateway-temp-${Date.now()}`);
  mkdirSync(tempPath, { recursive: true });

  const calls: string[] = [];
  const gateway = new Gateway(
    {
      startSessionFromSlack: async () => {
        calls.push('start');
        return createSession();
      },
      continueSessionFromSlack: async () => {
        calls.push('continue');
        return createSession();
      },
    } as any,
    {
      postThreadMessage: async () => {},
      uploadThreadFiles: async () => {},
      setThreadStatus: async () => {},
    },
  );

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'hello',
    ts: '100.1',
    subtype: 'file_share',
    channel_type: 'im',
    temporary_directory: tempPath,
  });

  assert.deepEqual(calls, ['start']);
  assert.equal(existsSync(tempPath), false);
});
