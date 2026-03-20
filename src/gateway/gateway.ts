import type {
  ApprovalDecision,
  ContinueSessionInput,
  ResolveApprovalInput,
  Session,
  StartSessionInput,
} from '../domain/types.js';
import type { Orchestrator, GatewayNotifier } from '../orchestrator/orchestrator.js';

const debugSlackEvents = process.env.DEBUG_SLACK_EVENTS === 'true';

export interface SlackPublisher {
  postThreadMessage(input: {
    channel_id: string;
    root_thread_ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<void>;
  setThreadStatus(input: {
    channel_id: string;
    root_thread_ts: string;
    status: string;
    loading_messages?: string[];
  }): Promise<void>;
}

export interface SlackStatusPublisher extends Pick<SlackPublisher, 'setThreadStatus'> {}

export interface SlackMessageEvent {
  team_id: string;
  channel_id: string;
  user_id: string;
  text: string;
  ts: string;
  thread_ts?: string;
  assistant_thread?: {
    thread_ts?: string;
  };
  channel_type: 'im' | 'channel' | 'group' | 'mpim';
  subtype?: string;
}

export interface SlackApprovalAction {
  team_id: string;
  channel_id: string;
  root_thread_ts: string;
  approval_id: string;
  decision: ApprovalDecision;
}

export class Gateway implements GatewayNotifier {
  private readonly statusPublishers = new Map<string, SlackStatusPublisher>();

  public constructor(
    private readonly orchestrator: Orchestrator,
    private readonly publisher: SlackPublisher,
  ) {}

  public async handleMessageEvent(
    event: SlackMessageEvent,
    statusPublisher?: SlackStatusPublisher,
  ): Promise<void> {
    if (event.channel_type !== 'im' || event.subtype) {
      return;
    }

    const rootThreadTs = event.assistant_thread?.thread_ts ?? event.thread_ts ?? event.ts;
    const run = async () => {
      if (rootThreadTs === event.ts) {
        const input: StartSessionInput = {
          slack_team_id: event.team_id,
          slack_channel_id: event.channel_id,
          slack_root_thread_ts: rootThreadTs,
          user_id: event.user_id,
          text: event.text,
        };
        await this.orchestrator.startSessionFromSlack(input);
        return;
      }

      const input: ContinueSessionInput = {
        slack_team_id: event.team_id,
        slack_channel_id: event.channel_id,
        slack_root_thread_ts: rootThreadTs,
        user_id: event.user_id,
        text: event.text,
      };
      await this.orchestrator.continueSessionFromSlack(input);
    };

    await this.withStatusPublisher(rootThreadTs, statusPublisher, run);
  }

  public async handleApprovalAction(action: SlackApprovalAction): Promise<void> {
    const input: ResolveApprovalInput = {
      slack_team_id: action.team_id,
      slack_channel_id: action.channel_id,
      slack_root_thread_ts: action.root_thread_ts,
      approval_id: action.approval_id,
      decision: action.decision,
    };

    await this.orchestrator.resolveApproval(input);
  }

  public async notifyProgress(session: Session, message: string): Promise<void> {
    logSlackPublish('progress', session.slack_root_thread_ts, {
      status: message,
      uses_status_publisher: this.statusPublishers.has(session.slack_root_thread_ts),
    });
    await this.resolveStatusPublisher(session.slack_root_thread_ts).setThreadStatus({
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      status: message,
      loading_messages: [message],
    });
  }

  public async notifyApproval(
    session: Session,
    approval: { approval_id: string; prompt: string },
  ): Promise<void> {
    logSlackPublish('approval', session.slack_root_thread_ts, {
      uses_status_publisher: this.statusPublishers.has(session.slack_root_thread_ts),
    });
    const actionValue = JSON.stringify({
      team_id: session.slack_team_id,
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      approval_id: approval.approval_id,
    });

    await this.publisher.postThreadMessage({
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      text: approval.prompt,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: approval.prompt,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'approve',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              value: actionValue,
            },
            {
              type: 'button',
              action_id: 'reject',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              value: actionValue,
            },
          ],
        },
      ],
    });
  }

  public async notifyCompleted(session: Session, message: string): Promise<void> {
    logSlackPublish('completed', session.slack_root_thread_ts, {
      text: message,
      uses_status_publisher: this.statusPublishers.has(session.slack_root_thread_ts),
    });
    await this.publisher.postThreadMessage({
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      text: message,
    });
  }

  public async notifyFailed(session: Session, message: string): Promise<void> {
    logSlackPublish('failed', session.slack_root_thread_ts, {
      text: message,
      uses_status_publisher: this.statusPublishers.has(session.slack_root_thread_ts),
    });
    await this.publisher.postThreadMessage({
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      text: `:warning: ${message}`,
    });
  }

  private resolveStatusPublisher(rootThreadTs: string): SlackStatusPublisher {
    return this.statusPublishers.get(rootThreadTs) ?? this.publisher;
  }

  private async withStatusPublisher(
    rootThreadTs: string,
    statusPublisher: SlackStatusPublisher | undefined,
    run: () => Promise<void>,
  ): Promise<void> {
    if (!statusPublisher) {
      await run();
      return;
    }

    this.statusPublishers.set(rootThreadTs, statusPublisher);
    try {
      await run();
    } finally {
      this.statusPublishers.delete(rootThreadTs);
    }
  }
}

function logSlackPublish(
  type: string,
  rootThreadTs: string,
  details: Record<string, unknown>,
): void {
  if (!debugSlackEvents) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[slack:publish]', JSON.stringify({ type, root_thread_ts: rootThreadTs, ...details }));
}
