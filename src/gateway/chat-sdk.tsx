/** @jsxImportSource chat */

import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack';
import { Chat, type StateAdapter } from 'chat';
import { buildResolvedApprovalCard } from './gateway-cards.js';
import type { Gateway, GatewayApprovalAction, GatewayThread } from './gateway.js';
import type { ThreadSessionState } from '../domain/types.js';
import { buildSlackMessageEvent, type RawSlackMessageEvent } from './slack-message-event.js';

// Chat SDK の thread 型 (state が Promise を許容するなど) と Gateway 側で扱う
// GatewayThread の差分を吸収する。共通の as 経由にすることでキャストを 1 箇所にまとめる。
function asGatewayThread(thread: unknown): GatewayThread {
  return thread as GatewayThread;
}

export interface ChatGatewayRuntime {
  bot: Chat<{ slack: SlackAdapter }, ThreadSessionState>;
  slackAdapter: SlackAdapter;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ChatGatewayRuntimeConfig {
  botToken: string;
  appToken: string;
  botUserName: string;
  state: StateAdapter;
  slackAttachmentMaxBytes: number;
  slackAttachmentTmpDir?: string;
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
    mode: 'socket',
    appToken: config.appToken,
    botToken: config.botToken,
  });

  const bot = new Chat<{ slack: SlackAdapter }, ThreadSessionState>({
    userName: config.botUserName,
    adapters: {
      slack: slackAdapter,
    },
    state: config.state,
  });

  bot.onDirectMessage(async (thread, message) => {
    const slackEvent = await buildSlackMessageEvent(
      message.raw as RawSlackMessageEvent,
      config.botToken,
      config.slackAttachmentMaxBytes,
      { tmpDir: config.slackAttachmentTmpDir },
    );
    if (!slackEvent) {
      return;
    }

    await thread.subscribe();
    await gateway.handleMessage(asGatewayThread(thread), slackEvent);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    const slackEvent = await buildSlackMessageEvent(
      message.raw as RawSlackMessageEvent,
      config.botToken,
      config.slackAttachmentMaxBytes,
      { tmpDir: config.slackAttachmentTmpDir },
    );
    if (!slackEvent) {
      return;
    }

    await gateway.handleMessage(asGatewayThread(thread), slackEvent);
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

      const approved = await gateway.handleApprovalAction(asGatewayThread(event.thread), action);
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
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        '[gateway:approval-action-error]',
        JSON.stringify({
          error: String(error),
          action_id: event.actionId,
          thread_id: event.threadId,
          message_id: event.messageId,
        }),
      );
      return;
    }
  });

  return {
    bot,
    slackAdapter,
    start: async () => {
      await bot.initialize();
    },
    stop: async () => {
      await bot.shutdown();
    },
  };
}
