import { App } from '@slack/bolt';
import { Gateway, type SlackApprovalAction, type SlackMessageEvent } from './gateway.js';

export interface BoltGatewayRuntime {
  app: App;
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
}

interface BoltRuntimeConfig {
  botToken: string;
  appToken: string;
}

interface RawSlackMessageEvent {
  team?: string;
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  parent_user_id?: string;
  assistant_thread?: {
    thread_ts?: string;
  };
  channel_type?: 'im' | 'channel' | 'group' | 'mpim';
  subtype?: string;
}

const debugSlackEvents = process.env.DEBUG_SLACK_EVENTS === 'true';

export function createBoltGatewayRuntime(
  gateway: Gateway,
  config: BoltRuntimeConfig,
): BoltGatewayRuntime {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
  });

  app.event('message', async ({ event }) => {
    const messageEvent = toSlackMessageEvent(event as RawSlackMessageEvent);
    logSlackEvent('message', event as RawSlackMessageEvent);
    if (!messageEvent) {
      return;
    }

    await gateway.handleMessageEvent(messageEvent);
  });

  const actionHandler = async ({ ack, body, action }: any, decision: 'approve' | 'reject') => {
    await ack();

    const raw = action?.value;
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Omit<SlackApprovalAction, 'decision'>;

    await gateway.handleApprovalAction({
      ...parsed,
      decision,
    });

    if (body?.channel?.id) {
      await app.client.chat.postMessage({
        channel: body.channel.id,
        thread_ts: parsed.root_thread_ts,
        text: `approval decision: ${decision}`,
      });
    }
  };

  app.action('approve', async (args) => actionHandler(args, 'approve'));
  app.action('reject', async (args) => actionHandler(args, 'reject'));

  return {
    app,
    start: async (port?: number) => {
      if (typeof port === 'number') {
        await app.start(port);
        return;
      }
      await app.start();
    },
    stop: async () => {
      await app.stop();
    },
  };
}

export function toSlackMessageEvent(event: RawSlackMessageEvent): SlackMessageEvent | null {
  if (!event.team || !event.user || !event.text || !event.channel_type) {
    return null;
  }

  return {
    team_id: event.team,
    channel_id: event.channel,
    user_id: event.user,
    text: event.text,
    ts: event.ts,
    thread_ts: event.thread_ts,
    parent_user_id: event.parent_user_id,
    assistant_thread: event.assistant_thread,
    channel_type: event.channel_type,
    subtype: event.subtype,
  };
}

function logSlackEvent(type: string, event: RawSlackMessageEvent): void {
  if (!debugSlackEvents) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    '[slack:event]',
    JSON.stringify({
      type,
      team: event.team ?? null,
      channel: event.channel ?? null,
      user: event.user ?? null,
      ts: event.ts ?? null,
      thread_ts: event.thread_ts ?? null,
      parent_user_id: event.parent_user_id ?? null,
      assistant_thread_ts: event.assistant_thread?.thread_ts ?? null,
      channel_type: event.channel_type ?? null,
      subtype: event.subtype ?? null,
      has_text: Boolean(event.text),
    }),
  );
}
