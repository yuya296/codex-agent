import { App } from '@slack/bolt';
import { Gateway, type SlackApprovalAction } from './gateway.js';

export interface BoltGatewayRuntime {
  app: App;
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
}

export function createBoltGatewayRuntime(gateway: Gateway): BoltGatewayRuntime {
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });

  app.event('message', async ({ event }) => {
    const messageEvent = event as {
      team?: string;
      channel: string;
      user?: string;
      text?: string;
      ts: string;
      thread_ts?: string;
      channel_type?: 'im' | 'channel' | 'group' | 'mpim';
      subtype?: string;
    };

    if (!messageEvent.team || !messageEvent.user || !messageEvent.text || !messageEvent.channel_type) {
      return;
    }

    await gateway.handleMessageEvent({
      team_id: messageEvent.team,
      channel_id: messageEvent.channel,
      user_id: messageEvent.user,
      text: messageEvent.text,
      ts: messageEvent.ts,
      thread_ts: messageEvent.thread_ts,
      channel_type: messageEvent.channel_type,
      subtype: messageEvent.subtype,
    });
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
