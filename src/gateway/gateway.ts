import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import type {
  ApprovalDecision,
  ContinueSessionInput,
  ResolveApprovalInput,
  Session,
  StartSessionInput,
} from '../domain/types.js';
import type { Orchestrator, GatewayNotifier } from '../orchestrator/orchestrator.js';
import { parseAdminCommand, type AdminCommandHandler } from '../admin/commands.js';

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

const SLACK_LOADING_MESSAGE_MAX_LENGTH = 50;
const LOCAL_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

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
    } finally {
      if (event.temporary_directory) {
        await rm(event.temporary_directory, { recursive: true, force: true });
      }
    }
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

export function toSlackLoadingMessage(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= SLACK_LOADING_MESSAGE_MAX_LENGTH) {
    return singleLine || 'thinking...';
  }

  return `${singleLine.slice(0, SLACK_LOADING_MESSAGE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function toSlackMrkdwn(message: string): string {
  return renderSlackText(message);
}

export function renderSlackCompletedMessage(message: string): {
  text: string;
  images: Array<{ path: string; alt_text?: string }>;
} {
  const extracted = extractLocalImageFiles(message);
  const renderedText = toSlackMrkdwn(extracted.text).trim();

  return {
    text: renderedText || (extracted.images.length === 0 ? message : ''),
    images: extracted.images,
  };
}

export function extractLocalImageFiles(message: string): {
  text: string;
  images: Array<{ path: string; alt_text?: string }>;
} {
  const images = new Map<string, { path: string; alt_text?: string }>();
  let text = message;

  text = text.replace(/!\[([^\]]*)\]\((\/[^)\s]+\.(?:png|jpe?g|gif|webp))\)/giu, (match, alt, path) => {
    registerLocalImage(images, path, alt);
    return '';
  });

  text = text.replace(/(^|[\s(])((\/[^\s)]+?\.(?:png|jpe?g|gif|webp)))(?=$|[\s),.;!?])/giu, (match, prefix, path) => {
    registerLocalImage(images, path);
    return prefix;
  });

  return {
    text: cleanupExtractedMessage(text),
    images: [...images.values()],
  };
}

function registerLocalImage(
  images: Map<string, { path: string; alt_text?: string }>,
  candidatePath: string,
  altText?: string,
): void {
  const normalizedPath = candidatePath.trim();
  const extension = extname(normalizedPath).toLowerCase();
  if (!LOCAL_IMAGE_EXTENSIONS.has(extension) || !existsSync(normalizedPath)) {
    return;
  }

  const existing = images.get(normalizedPath);
  if (existing) {
    if (!existing.alt_text && altText?.trim()) {
      existing.alt_text = altText.trim();
    }
    return;
  }

  images.set(normalizedPath, {
    path: normalizedPath,
    alt_text: altText?.trim() || undefined,
  });
}

function cleanupExtractedMessage(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function renderSlackText(text: string): string {
  const lines = text.split('\n');
  let inCodeBlock = false;

  return lines
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return line;
      }

      if (inCodeBlock) {
        return line;
      }

      if (!line.trim()) {
        return '';
      }

      const unorderedListMatch = line.match(/^(\s*)[-*+]\s+(.*)$/u);
      if (unorderedListMatch) {
        const indent = unorderedListMatch[1] ?? '';
        const content = unorderedListMatch[2] ?? '';
        return `${indent}* ${renderSlackInline(content)}`;
      }

      const orderedListMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/u);
      if (orderedListMatch) {
        const indent = orderedListMatch[1] ?? '';
        const number = orderedListMatch[2] ?? '';
        const content = orderedListMatch[3] ?? '';
        return `${indent}${number}. ${renderSlackInline(content)}`;
      }

      return renderSlackInline(line);
    })
    .join('\n');
}

function renderSlackInline(line: string): string {
  const segments = line.split(/(`[^`]*`)/u);

  return segments
    .map((segment) => {
      if (segment.startsWith('`') && segment.endsWith('`')) {
        return segment;
      }

      return segment
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gu, '$1 <$2>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu, '<$2|$1>')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, '_$1_')
        .replace(/\*\*([^*\n]+)\*\*/gu, '*$1*')
        .replace(/__([^_\n]+)__/gu, '*$1*')
        .replace(/~~([^~\n]+)~~/gu, '~$1~');
    })
    .join('');
}
