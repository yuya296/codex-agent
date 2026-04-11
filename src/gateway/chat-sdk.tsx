/** @jsxImportSource chat */

import { readFile } from 'node:fs/promises';
import { serve, type ServerType } from '@hono/node-server';
import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack';
import { Chat, type CardElement, type StateAdapter } from 'chat';
import { Hono } from 'hono';
import type { Gateway, SlackApprovalAction, SlackPublisher } from './gateway.js';
import { buildSlackMessageEvent, type RawSlackMessageEvent } from './slack-message-event.js';
import { buildResolvedApprovalCard } from './gateway-cards.js';

export interface ChatGatewayRuntime {
  bot: Chat<{ slack: SlackAdapter }>;
  slackAdapter: SlackAdapter;
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
}

interface ChatGatewayRuntimeConfig {
  botToken: string;
  signingSecret: string;
  botUserName: string;
  state: StateAdapter;
}

interface SlackPublisherOptions {
  slackAgentChatStatusEnabled: boolean;
}

export function createChatGatewayRuntime(
  gateway: Gateway,
  config: ChatGatewayRuntimeConfig,
): ChatGatewayRuntime {
  const slackAdapter = createSlackAdapter({
    botToken: config.botToken,
    signingSecret: config.signingSecret,
  });
  const bot = new Chat({
    userName: config.botUserName,
    adapters: {
      slack: slackAdapter,
    },
    state: config.state,
  });

  bot.onNewMention(async (thread, message) => {
    const slackEvent = await buildSlackMessageEvent(message.raw as RawSlackMessageEvent, config.botToken);
    if (!slackEvent || slackEvent.channel_type !== 'im') {
      return;
    }

    await thread.subscribe();
    await gateway.handleMessageEvent(slackEvent);
  });

  bot.onSubscribedMessage(async (_thread, message) => {
    const slackEvent = await buildSlackMessageEvent(message.raw as RawSlackMessageEvent, config.botToken);
    if (!slackEvent) {
      return;
    }

    await gateway.handleMessageEvent(slackEvent);
  });

  bot.onAction(['approve', 'reject'], async (event) => {
    if (!event.value) {
      return;
    }

    const action = JSON.parse(event.value) as Omit<SlackApprovalAction, 'decision'>;
    const decision = event.actionId === 'approve' ? 'approve' : 'reject';

    await gateway.handleApprovalAction({
      ...action,
      decision,
    });

    if (!event.thread) {
      return;
    }

    await slackAdapter.editMessage(event.threadId, event.messageId, {
      card: buildResolvedApprovalCard(action.prompt ?? 'Approval required to continue.', decision),
      fallbackText: `${action.prompt ?? 'Approval required to continue.'}\n\n選択: ${
        decision === 'approve' ? 'Approve' : 'Reject'
      }`,
    });
  });

  const app = new Hono();
  app.post('/api/webhooks/slack', async (c) => bot.webhooks.slack(c.req.raw, {
    waitUntil: (task) => c.executionCtx.waitUntil(task),
  }));

  let server: ServerType | null = null;

  return {
    bot,
    slackAdapter,
    start: async (port?: number) => {
      await bot.initialize();
      server = serve({
        fetch: app.fetch,
        port,
      });
    },
    stop: async () => {
      server?.close();
      server = null;
      await bot.shutdown();
    },
  };
}

export function createSlackPublisher(
  getAdapter: () => SlackAdapter,
  options: SlackPublisherOptions,
): SlackPublisher {
  return {
    postThreadMessage: async ({ channel_id, root_thread_ts, text, card }) => {
      await getAdapter().postMessage(
        toThreadId(getAdapter(), channel_id, root_thread_ts),
        card
          ? {
              card: card as CardElement,
              fallbackText: text,
            }
          : { raw: text },
      );
    },
    uploadThreadFiles: async ({ channel_id, root_thread_ts, files }) => {
      for (const file of files) {
        const data = await readFile(file.path);
        await getAdapter().postMessage(toThreadId(getAdapter(), channel_id, root_thread_ts), {
          raw: '',
          files: [
            {
              data,
              filename: file.path.split('/').at(-1) ?? 'upload',
            },
          ],
        });
      }
    },
    setThreadStatus: async ({ channel_id, root_thread_ts, status, loading_messages }) => {
      if (!options.slackAgentChatStatusEnabled) {
        await getAdapter().postMessage(toThreadId(getAdapter(), channel_id, root_thread_ts), {
          raw: status,
        });
        return;
      }

      await getAdapter().setAssistantStatus(
        channel_id,
        root_thread_ts,
        status,
        loading_messages,
      );
    },
  };
}

function toThreadId(adapter: SlackAdapter, channelId: string, threadTs: string): string {
  return adapter.encodeThreadId({
    channel: channelId,
    threadTs,
  });
}
