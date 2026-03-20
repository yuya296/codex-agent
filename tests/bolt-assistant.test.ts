import test from 'node:test';
import assert from 'node:assert/strict';
import { type Logger, LogLevel } from '@slack/bolt';
import { createSlackAssistant, toSlackMessageEvent } from '../src/gateway/bolt.js';

function createLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    setName: () => {},
    setLevel: () => {},
    getLevel: () => LogLevel.INFO,
  };
}

test('toSlackMessageEvent maps assistant thread message payload', () => {
  assert.deepEqual(
    toSlackMessageEvent({
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      assistant_thread: { thread_ts: '100.1' },
      channel_type: 'im',
    }),
    {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      assistant_thread: { thread_ts: '100.1' },
      channel_type: 'im',
      subtype: undefined,
    },
  );
});

test('assistant middleware routes threaded dm messages to gateway.handleMessageEvent', async () => {
  const handled: unknown[] = [];
  const statusCalls: unknown[] = [];
  const assistant = createSlackAssistant({
    handleMessageEvent: async (event, statusPublisher) => {
      handled.push(event);
      await statusPublisher?.setThreadStatus({
        channel_id: 'D1',
        root_thread_ts: '100.1',
        status: 'thinking...',
        loading_messages: ['thinking...'],
      });
    },
  });

  let nextCalled = false;
  await assistant.getMiddleware()({
    payload: {
      type: 'message',
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      channel_type: 'im',
    },
    body: {},
    context: {},
    client: {
      assistant: {
        threads: {
          setStatus: async (input: unknown) => {
            statusCalls.push(input);
            return {};
          },
        },
      },
      chat: {
        postMessage: async (input: unknown) => {
          return {};
        },
      },
      conversations: {
        replies: async () => ({
          messages: [],
        }),
      },
    },
    logger: createLogger(),
    next: async () => {
      nextCalled = true;
    },
  } as any);

  assert.equal(nextCalled, false);
  assert.deepEqual(handled, [
    {
      team_id: 'T1',
      channel_id: 'D1',
      user_id: 'U1',
      text: 'hello',
      ts: '100.2',
      thread_ts: '100.1',
      assistant_thread: undefined,
      channel_type: 'im',
      subtype: undefined,
    },
  ]);
  assert.deepEqual(statusCalls, [
    {
      channel_id: 'D1',
      thread_ts: '100.1',
      status: 'thinking...',
      loading_messages: ['thinking...'],
    },
  ]);
});

test('assistant middleware ignores top-level dm messages and lets next listener handle them', async () => {
  const assistant = createSlackAssistant({
    handleMessageEvent: async () => {},
  });

  let nextCalled = false;
  await assistant.getMiddleware()({
    payload: {
      type: 'message',
      team: 'T1',
      channel: 'D1',
      user: 'U1',
      text: 'hello',
      ts: '100.1',
      channel_type: 'im',
    },
    body: {},
    context: {},
    client: {},
    logger: createLogger(),
    next: async () => {
      nextCalled = true;
    },
  } as any);

  assert.equal(nextCalled, true);
});
