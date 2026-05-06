import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway, type SlackMessageEvent } from '../../../src/gateway/gateway.js';
import {
  MockGatewayThread,
  MockWorkerClient,
} from '../../support/helpers.js';
import {
  extractLocalImageFiles,
  renderSlackCompletedMessage,
  toSlackLoadingMessage,
  toSlackMrkdwn,
} from '../../../src/gateway/gateway.js';

test('gateway controller turns loading text into a single Slack-friendly line before posting', () => {
  const loading = toSlackLoadingMessage(
    '`playwright-cli` という名前の実体があるかを、そのコマンド名で直接確認します。\n権限制約があります。',
  );

  assert.equal(loading.length <= 50, true);
  assert.equal(loading.includes('\n'), false);
  assert.match(loading, /…$/);
});

test('gateway controller posts a fallback thread message when Slack typing status fails during a progress update', async () => {
  const thread = new MockGatewayThread();
  thread.startTypingImpl = async () => {
    throw new Error('invalid_arguments');
  };

  const gateway = new Gateway(new MockWorkerClient(), undefined, {
    slackAgentChatStatusEnabled: true,
  });

  await gateway.notifyProgress(thread as any, 'long progress message');

  assert.deepEqual(thread.postCalls, ['long progress message']);
});

test('gateway controller skips typing status entirely when Slack chat status is disabled', async () => {
  const thread = new MockGatewayThread();
  const gateway = new Gateway(new MockWorkerClient(), undefined, {
    slackAgentChatStatusEnabled: false,
  });

  await gateway.notifyProgress(thread as any, 'long progress message');

  assert.deepEqual(thread.startTypingCalls, []);
  assert.deepEqual(thread.postCalls, ['long progress message']);
});

test('gateway controller renders markdown into Slack mrkdwn while preserving list structure', () => {
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

test('gateway controller converts completed answers before posting them to the Slack thread', async () => {
  const thread = new MockGatewayThread();
  const gateway = new Gateway(new MockWorkerClient());
  const expected = renderSlackCompletedMessage(
    ['# Heading', '', '- **bold** item', '- [example](https://example.com)'].join('\n'),
  );

  await gateway.notifyCompleted(
    thread as any,
    ['# Heading', '', '- **bold** item', '- [example](https://example.com)'].join('\n'),
  );

  assert.equal(thread.postCalls.length, 1);
  assert.deepEqual(thread.postCalls[0], { markdown: expected.text });
});

test('gateway controller extracts local image references from both markdown image tags and bare paths', () => {
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

test('gateway controller splits completed messages into thread text and image uploads when local files are present', () => {
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

test('gateway controller creates thread state for the first DM and sends the message to the worker', async () => {
  const worker = new MockWorkerClient();
  worker.createThreadImpl = async () => ({ codex_thread_id: 'codex-42' });
  worker.sendUserMessageImpl = async () => [];

  const thread = new MockGatewayThread();
  thread.state = null;

  const gateway = new Gateway(worker);

  await gateway.handleMessage(thread as any, createDirectMessage('hello'));

  assert.deepEqual(worker.callLog, ['createThread', 'sendUserMessage']);
  assert.equal(thread.setStateCalls.length, 1);
  assert.deepEqual(thread.setStateCalls[0]?.state, {
    codexThreadId: 'codex-42',
    pendingApprovalId: null,
  });
});

test('gateway controller sends follow-up messages as steer messages once thread.state exists', async () => {
  const worker = new MockWorkerClient();
  worker.sendSteerMessageImpl = async () => [];

  const thread = new MockGatewayThread();
  thread.state = {
    codexThreadId: 'codex-42',
    pendingApprovalId: null,
  };

  const gateway = new Gateway(worker);

  await gateway.handleMessage(thread as any, createDirectMessage('follow up'));

  assert.deepEqual(worker.callLog, ['sendSteerMessage']);
  assert.deepEqual(worker.sendSteerMessageCalls[0], {
    codex_thread_id: 'codex-42',
    text: 'follow up',
    user_id: 'U1',
  });
});

test('gateway controller rejects the previous approval before resuming the same thread', async () => {
  const worker = new MockWorkerClient();
  worker.sendApprovalDecisionImpl = async () => [];
  worker.sendUserMessageImpl = async () => [];

  const thread = new MockGatewayThread();
  thread.state = {
    codexThreadId: 'codex-42',
    pendingApprovalId: 'approval-1',
  };

  const gateway = new Gateway(worker);

  await gateway.handleMessage(thread as any, createDirectMessage('continue'));

  assert.deepEqual(worker.callLog, ['sendApprovalDecision', 'sendUserMessage']);
  assert.equal(worker.sendApprovalDecisionCalls[0]?.decision, 'reject');
  assert.equal(thread.state?.pendingApprovalId, null);
});

test('gateway controller keeps the pending approval when auto-reject fails', async () => {
  const worker = new MockWorkerClient();
  worker.sendApprovalDecisionImpl = async () => {
    throw new Error('unknown approval id');
  };

  const thread = new MockGatewayThread();
  thread.state = {
    codexThreadId: 'codex-42',
    pendingApprovalId: 'approval-1',
  };

  const gateway = new Gateway(worker);

  await gateway.handleMessage(thread as any, createDirectMessage('continue'));

  assert.deepEqual(worker.callLog, ['sendApprovalDecision']);
  assert.equal(thread.state?.pendingApprovalId, 'approval-1');
  assert.equal(thread.postCalls[0], ':warning: worker execution failed: Error: unknown approval id');
});

test('gateway controller resolves approval actions using the thread state', async () => {
  const worker = new MockWorkerClient();
  worker.sendApprovalDecisionImpl = async () => [{ type: 'completed', message: 'approval:approve' }];
  const thread = new MockGatewayThread();
  thread.state = {
    codexThreadId: 'codex-42',
    pendingApprovalId: 'approval-1',
  };

  const gateway = new Gateway(worker);

  await gateway.handleApprovalAction(thread as any, {
    approval_id: 'approval-1',
    prompt: 'approve this?',
    decision: 'approve',
  });

  assert.deepEqual(worker.callLog, ['sendApprovalDecision']);
  assert.equal(worker.sendApprovalDecisionCalls[0]?.approval_id, 'approval-1');
  assert.equal(thread.state?.pendingApprovalId, null);
  assert.deepEqual(thread.postCalls, [{ markdown: 'approval:approve' }]);
});

test('gateway controller reports approval failures without resolving the Slack card', async () => {
  const worker = new MockWorkerClient();
  worker.sendApprovalDecisionImpl = async () => {
    throw new Error('unknown approval id');
  };
  const thread = new MockGatewayThread();
  thread.state = {
    codexThreadId: 'codex-42',
    pendingApprovalId: 'approval-1',
  };

  const gateway = new Gateway(worker);

  const approved = await gateway.handleApprovalAction(thread as any, {
    approval_id: 'approval-1',
    prompt: 'approve this?',
    decision: 'approve',
  });

  assert.equal(approved, false);
  assert.equal(thread.state?.pendingApprovalId, 'approval-1');
  assert.equal(thread.postCalls[0], ':warning: worker execution failed: Error: unknown approval id');
});

test('gateway controller cleans up temporary files after handling the event', async () => {
  const tempPath = join(tmpdir(), `codex-agent-gateway-temp-${Date.now()}`);
  mkdirSync(tempPath, { recursive: true });

  const gateway = new Gateway(new MockWorkerClient());
  const thread = new MockGatewayThread();

  await gateway.handleMessage(thread as any, {
    team_id: 'T1',
    channel_id: 'C1',
    user_id: 'U1',
    text: 'hello',
    ts: '100.1',
    channel_type: 'channel',
    temporary_directory: tempPath,
  });

  assert.equal(existsSync(tempPath), false);
});

function createDirectMessage(text: string): SlackMessageEvent {
  return {
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text,
    ts: '100.1',
    channel_type: 'im',
  };
}
