import test from 'node:test';
import assert from 'node:assert/strict';
import { createSlackPublisher } from '../../../src/gateway/chat-sdk.js';

function createAdapterDouble() {
  const calls = {
    postMessage: [] as Array<Record<string, unknown>>,
    setStatus: [] as Array<Record<string, unknown>>,
  };

  return {
    adapter: {
      encodeThreadId: ({ channel, threadTs }: { channel: string; threadTs: string }) =>
        `slack:${channel}:${threadTs}`,
      postMessage: async (threadId: string, input: Record<string, unknown>) => {
        calls.postMessage.push({ threadId, ...input });
      },
      setAssistantStatus: async (
        channelId: string,
        threadTs: string,
        status: string,
        loadingMessages?: string[],
      ) => {
        calls.setStatus.push({ channelId, threadTs, status, loadingMessages });
      },
    },
    calls,
  };
}

test('Slack publisher falls back to chat.postMessage when the thread status API is disabled', async () => {
  const { adapter, calls } = createAdapterDouble();
  const publisher = createSlackPublisher(() => adapter as any, {
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
    threadId: 'slack:D1:100.1',
    raw: 'thinking...',
  });
});
