/** @jsxImportSource chat */

import { serve, type ServerType } from '@hono/node-server';
import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack';
import { Chat, type StateAdapter } from 'chat';
import { Hono } from 'hono';
import { buildResolvedApprovalCard } from './gateway-cards.js';
import type { Gateway, GatewayApprovalAction, SlackMessageEvent } from './gateway.js';
import type { ThreadSessionState } from '../domain/types.js';
import { buildSlackMessageEvent, type RawSlackMessageEvent } from './slack-message-event.js';

export interface ChatGatewayRuntime {
  bot: Chat<{ slack: SlackAdapter }, ThreadSessionState>;
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

type ApprovalActionPayload = {
  approval_id: string;
  prompt?: string;
};

export function createChatGatewayRuntime(
  gateway: Gateway,
  config: ChatGatewayRuntimeConfig,
): ChatGatewayRuntime {
  const slackAdapter = createSlackAdapter({
    botToken: config.botToken,
    signingSecret: config.signingSecret,
  });

  const bot = new Chat<{ slack: SlackAdapter }, ThreadSessionState>({
    userName: config.botUserName,
    adapters: {
      slack: slackAdapter,
    },
    state: config.state,
  });

  bot.onDirectMessage(async (thread, message) => {
    const slackEvent = await toSlackGatewayEvent(message.raw as RawSlackMessageEvent, config.botToken);
    if (!slackEvent) {
      return;
    }

    await thread.subscribe();
    await gateway.handleMessage(thread as any, slackEvent);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    const slackEvent = await toSlackGatewayEvent(message.raw as RawSlackMessageEvent, config.botToken);
    if (!slackEvent) {
      return;
    }

    await gateway.handleMessage(thread as any, slackEvent);
  });

  bot.onAction(['approve', 'reject'], async (event) => {
    if (!event.thread || !event.value) {
      return;
    }

    try {
      const payload = JSON.parse(event.value) as ApprovalActionPayload;
      const decision = event.actionId === 'approve' ? 'approve' : 'reject';
      const action: GatewayApprovalAction = {
        approval_id: payload.approval_id,
        prompt: payload.prompt,
        decision,
      };

      const approved = await gateway.handleApprovalAction(event.thread as any, action);
      if (!approved) {
        return;
      }
      await slackAdapter.editMessage(event.threadId, event.messageId, {
        card: buildResolvedApprovalCard(
          payload.prompt ?? 'Approval required to continue.',
          decision,
        ),
        fallbackText: `${payload.prompt ?? 'Approval required to continue.'}\n\n選択: ${
          decision === 'approve' ? 'Approve' : 'Reject'
        }`,
      });
    } catch {
      return;
    }
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

async function toSlackGatewayEvent(
  rawEvent: RawSlackMessageEvent,
  botToken: string,
): Promise<SlackMessageEvent | null> {
  return buildSlackMessageEvent(rawEvent, botToken);
}
