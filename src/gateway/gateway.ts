import { rm } from 'node:fs/promises';
import type {
  ApprovalDecision,
  ContinueSessionInput,
  ResolveApprovalInput,
  Session,
  StartSessionInput,
} from '../domain/types.js';
import type { Orchestrator, GatewayNotifier } from '../orchestrator/orchestrator.js';
import { parseAdminCommand, type AdminCommandHandler } from '../admin/commands.js';
import {
  renderSlackCompletedMessage,
  toSlackLoadingMessage,
} from './gateway-renderer.js';

export interface SlackPublisher {
  postThreadMessage(input: {
    channel_id: string;
    root_thread_ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<void>;
  uploadThreadFiles(input: {
    channel_id: string;
    root_thread_ts: string;
    files: Array<{
      path: string;
      alt_text?: string;
    }>;
  }): Promise<void>;
  setThreadStatus(input: {
    channel_id: string;
    root_thread_ts: string;
    status: string;
    loading_messages?: string[];
  }): Promise<void>;
}

export interface SlackMessageEvent {
  team_id: string;
  channel_id: string;
  user_id: string;
  text: string;
  ts: string;
  thread_ts?: string;
  parent_user_id?: string;
  assistant_thread?: {
    thread_ts?: string;
  };
  channel_type: 'im' | 'channel' | 'group' | 'mpim';
  subtype?: string;
  attachment_warnings?: string[];
  downloaded_files_count?: number;
  temporary_directory?: string;
}

export interface SlackApprovalAction {
  team_id: string;
  channel_id: string;
  root_thread_ts: string;
  approval_id: string;
  prompt?: string;
  decision: ApprovalDecision;
}

export class Gateway implements GatewayNotifier {
  public constructor(
    private readonly orchestrator: Orchestrator,
    private readonly publisher: SlackPublisher,
    private readonly adminCommands?: AdminCommandHandler,
  ) {}

  public async handleMessageEvent(event: SlackMessageEvent): Promise<void> {
    try {
      if (event.channel_type !== 'im' || (event.subtype && event.subtype !== 'file_share')) {
        return;
      }

      const rootThreadTs =
        event.assistant_thread?.thread_ts ??
        (event.parent_user_id && event.thread_ts ? event.thread_ts : event.ts);

      if (event.attachment_warnings && event.attachment_warnings.length > 0) {
        await this.publisher.postThreadMessage({
          channel_id: event.channel_id,
          root_thread_ts: rootThreadTs,
          text: [
            ':warning: 次の添付ファイルは worker に渡していません。',
            ...event.attachment_warnings,
          ].join('\n'),
        });
      }

      if (!event.text.trim() && !event.downloaded_files_count && event.attachment_warnings?.length) {
        return;
      }

      const adminCommand = parseAdminCommand(event.text);
      if (adminCommand && this.adminCommands) {
        const response = await this.adminCommands.execute(adminCommand);
        await this.publisher.postThreadMessage({
          channel_id: event.channel_id,
          root_thread_ts: rootThreadTs,
          text: response,
        });
        return;
      }

      if (rootThreadTs === event.ts) {
        const input: StartSessionInput = {
          channel_team_id: event.team_id,
          channel_id: event.channel_id,
          channel_thread_id: rootThreadTs,
          user_id: event.user_id,
          text: event.text,
        };
        await this.orchestrator.startSession(input);
        return;
      }

      const input: ContinueSessionInput = {
        channel_team_id: event.team_id,
        channel_id: event.channel_id,
        channel_thread_id: rootThreadTs,
        user_id: event.user_id,
        text: event.text,
      };
      await this.orchestrator.continueSession(input);
    } finally {
      if (event.temporary_directory) {
        await rm(event.temporary_directory, { recursive: true, force: true });
      }
    }
  }

  public async handleApprovalAction(action: SlackApprovalAction): Promise<void> {
    const input: ResolveApprovalInput = {
      channel_team_id: action.team_id,
      channel_id: action.channel_id,
      channel_thread_id: action.root_thread_ts,
      approval_id: action.approval_id,
      decision: action.decision,
    };

    await this.orchestrator.resolveApproval(input);
  }

  public async notifyProgress(session: Session, message: string): Promise<void> {
    const loadingMessage = toSlackLoadingMessage(message);

    try {
      await this.publisher.setThreadStatus({
        channel_id: session.slack_channel_id,
        root_thread_ts: session.slack_root_thread_ts,
        status: message,
        loading_messages: [loadingMessage],
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[slack:status-error] ${String(error)}`);
      try {
        await this.publisher.postThreadMessage({
          channel_id: session.slack_channel_id,
          root_thread_ts: session.slack_root_thread_ts,
          text: loadingMessage,
        });
      } catch (fallbackError) {
        // eslint-disable-next-line no-console
        console.error(`[slack:status-fallback-error] ${String(fallbackError)}`);
      }
    }
  }

  public async notifyApproval(
    session: Session,
    approval: { approval_id: string; prompt: string },
  ): Promise<void> {
    const actionValue = JSON.stringify({
      team_id: session.slack_team_id,
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      approval_id: approval.approval_id,
      prompt: approval.prompt,
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
    const rendered = renderSlackCompletedMessage(message);

    if (rendered.text.trim()) {
      await this.publisher.postThreadMessage({
        channel_id: session.slack_channel_id,
        root_thread_ts: session.slack_root_thread_ts,
        text: rendered.text,
      });
    }

    if (rendered.images.length > 0) {
      await this.publisher.uploadThreadFiles({
        channel_id: session.slack_channel_id,
        root_thread_ts: session.slack_root_thread_ts,
        files: rendered.images,
      });
    }
  }

  public async notifyFailed(session: Session, message: string): Promise<void> {
    await this.publisher.postThreadMessage({
      channel_id: session.slack_channel_id,
      root_thread_ts: session.slack_root_thread_ts,
      text: `:warning: ${message}`,
    });
  }
}
export {
  extractLocalImageFiles,
  renderSlackCompletedMessage,
  toSlackLoadingMessage,
  toSlackMrkdwn,
} from './gateway-renderer.js';
