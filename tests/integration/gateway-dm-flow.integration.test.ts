import test from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../../src/gateway/gateway.js';
import {
  buildSlackMessageEvent,
  type RawSlackMessageEvent,
} from '../../src/gateway/slack-message-event.js';
import { MockGatewayThread, MockWorkerClient } from '../support/helpers.js';

test('Gateway DM flow turns a raw Slack DM event into a worker createThread + sendUserMessage call', async () => {
  const worker = new MockWorkerClient();
  const gateway = new Gateway(worker);
  const thread = new MockGatewayThread();

  const raw: RawSlackMessageEvent = {
    team: 'T1',
    channel: 'D1',
    user: 'U1',
    text: 'hello world',
    ts: '100.1',
    channel_type: 'im',
  };

  const slackEvent = await buildSlackMessageEvent(raw, 'xoxb-test-token', 10 * 1024 * 1024);
  assert.ok(slackEvent, 'buildSlackMessageEvent should produce an event for valid DM payloads');

  await gateway.handleMessage(thread as any, slackEvent!);

  assert.deepEqual(worker.callLog, ['createThread', 'sendUserMessage']);
  assert.equal(worker.sendUserMessageCalls.length, 1);
  assert.deepEqual(worker.sendUserMessageCalls[0], {
    codex_thread_id: 'thread-1',
    user_id: 'U1',
    text: 'hello world',
  });
  assert.ok(thread.setStateCalls.length >= 1);
  assert.deepEqual(thread.setStateCalls[0]?.state, {
    codexThreadId: 'thread-1',
    pendingApprovalId: null,
  });
});

test('Gateway DM flow drops non-DM channel events before invoking the worker', async () => {
  const worker = new MockWorkerClient();
  const gateway = new Gateway(worker);
  const thread = new MockGatewayThread();

  const raw: RawSlackMessageEvent = {
    team: 'T1',
    channel: 'C1',
    user: 'U1',
    text: 'hello',
    ts: '100.1',
    channel_type: 'channel',
  };

  const slackEvent = await buildSlackMessageEvent(raw, 'xoxb-test-token', 10 * 1024 * 1024);
  assert.ok(slackEvent);

  await gateway.handleMessage(thread as any, slackEvent!);

  assert.deepEqual(worker.callLog, []);
  assert.deepEqual(thread.postCalls, []);
});
