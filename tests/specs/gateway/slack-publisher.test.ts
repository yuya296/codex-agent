import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlackPublisher } from '../../../src/gateway/bolt.js';

function createAppDouble() {
  const calls = {
    postMessage: [] as Array<Record<string, unknown>>,
    filesUploadV2: [] as Array<Record<string, unknown>>,
    setStatus: [] as Array<Record<string, unknown>>,
  };

  return {
    app: {
      client: {
        chat: {
          postMessage: async (input: Record<string, unknown>) => {
            calls.postMessage.push(input);
          },
        },
        filesUploadV2: async (input: Record<string, unknown>) => {
          calls.filesUploadV2.push(input);
        },
        assistant: {
          threads: {
            setStatus: async (input: Record<string, unknown>) => {
              calls.setStatus.push(input);
            },
          },
        },
      },
    },
    calls,
  };
}

test('Slack publisher falls back to chat.postMessage when the thread status API is disabled', async () => {
  const { app, calls } = createAppDouble();
  const publisher = createSlackPublisher(() => app as any, {
    slackAgentChatStatusEnabled: false,
  });

  await publisher.setThreadStatus({
    channel_id: 'D1',
    root_thread_ts: '100.1',
    status: 'thinking...',
    loading_messages: ['thinking...'],
  });

  assert.equal(calls.postMessage.length, 1);
  assert.equal(calls.setStatus.length, 0);
  assert.deepEqual(calls.postMessage[0], {
    channel: 'D1',
    thread_ts: '100.1',
    text: 'thinking...',
  });
});
