import { rm, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AdminCommandHandler } from '../admin/commands.js';
import { parseAdminCommand } from '../admin/commands.js';
import type { ApprovalDecision, ApprovalRequest, ThreadSessionState } from '../domain/types.js';
import type { WorkerClient, WorkerRunEvent } from '../worker/types.js';
import { buildApprovalCard } from './gateway-cards.js';
import {
  renderSlackCompletedMessage,
  toSlackLoadingMessage,
} from './gateway-renderer.js';

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

export interface GatewayThread {
  state: ThreadSessionState | Promise<ThreadSessionState | null> | null;
  post(input: unknown): Promise<void>;
  startTyping(status?: string): Promise<void>;
  setState(state: ThreadSessionState, options?: { replace?: boolean }): Promise<void>;
}

export interface GatewayApprovalAction {
  approval_id: string;
  prompt?: string;
  decision: ApprovalDecision;
}

const SLACK_APPROVAL_PROMPT_BLOCK_LIMIT = 3000;

type WorkerFlowResult =
  | { ok: true }
  | { ok: false; error: string };

interface GatewayOptions {
  slackAgentChatStatusEnabled?: boolean;
}

export class Gateway {
  public constructor(
    private readonly workerClient: WorkerClient,
    private readonly adminCommands?: AdminCommandHandler,
    private readonly options: GatewayOptions = {},
  ) {}

  public async handleMessage(thread: GatewayThread, event: SlackMessageEvent): Promise<void> {
    try {
      if (event.channel_type !== 'im' || (event.subtype && event.subtype !== 'file_share')) {
        return;
      }

      if (event.attachment_warnings && event.attachment_warnings.length > 0) {
        await thread.post(
          [
            ':warning: 次の添付ファイルは worker に渡していません。',
            ...event.attachment_warnings,
          ].join('\n'),
        );
      }

      if (!event.text.trim() && !event.downloaded_files_count && event.attachment_warnings?.length) {
        return;
      }

      const adminCommand = parseAdminCommand(event.text);
      if (adminCommand && this.adminCommands) {
        await thread.post(await this.adminCommands.execute(adminCommand));
        return;
      }

      const state = await this.readThreadState(thread);
      if (!state?.codexThreadId) {
        const { codex_thread_id } = await this.workerClient.createThread();
        await this.saveThreadState(thread, {
          codexThreadId: codex_thread_id,
          pendingApprovalId: null,
        });

        await this.runWorkerFlow({
          thread,
          action: async (onEvent) => this.workerClient.sendUserMessage({
            codex_thread_id,
            user_id: event.user_id,
            text: event.text,
          }, { onEvent }),
        });
        return;
      }

      if (state.pendingApprovalId) {
        const approvalId = state.pendingApprovalId;
        const rejectResult = await this.runWorkerFlow({
          thread,
          notifyProgress: false,
          action: async (onEvent) => this.workerClient.sendApprovalDecision({
            codex_thread_id: state.codexThreadId,
            approval_id: approvalId,
            decision: 'reject',
          }, { onEvent }),
        });
        if (!rejectResult.ok) {
          return;
        }
        await this.clearPendingApprovalIfUnchanged(thread, state.codexThreadId, approvalId);

        await this.runWorkerFlow({
          thread,
          action: async (onEvent) => this.workerClient.sendUserMessage({
            codex_thread_id: state.codexThreadId,
            user_id: event.user_id,
            text: event.text,
          }, { onEvent }),
        });
        return;
      }

      await this.runWorkerFlow({
        thread,
        action: async (onEvent) => this.workerClient.sendSteerMessage({
          codex_thread_id: state.codexThreadId,
          user_id: event.user_id,
          text: event.text,
        }, { onEvent }),
      });
    } finally {
      if (event.temporary_directory) {
        await rm(event.temporary_directory, { recursive: true, force: true });
      }
    }
  }

  public async handleApprovalAction(
    thread: GatewayThread | null,
    action: GatewayApprovalAction,
  ): Promise<boolean> {
    if (!thread) {
      return false;
    }

    const state = await this.readThreadState(thread);
    if (!state?.codexThreadId) {
      return false;
    }

    // state を優先することで、ユーザが古いカードのボタンを押下した場合でも最新の
    // pendingApprovalId を解決する。worker 側で ID 不一致時はエラーを返す前提。
    const approvalId = state.pendingApprovalId ?? action.approval_id;
    const result = await this.runWorkerFlow({
      thread,
      notifyProgress: false,
      action: async (onEvent) => this.workerClient.sendApprovalDecision({
        codex_thread_id: state.codexThreadId,
        approval_id: approvalId,
        decision: action.decision,
      }, { onEvent }),
    });
    if (!result.ok) {
      return false;
    }

    await this.clearPendingApprovalIfUnchanged(thread, state.codexThreadId, approvalId);
    return true;
  }

  public async notifyProgress(thread: GatewayThread, message: string): Promise<void> {
    const loadingMessage = toSlackLoadingMessage(message);
    if (this.options.slackAgentChatStatusEnabled === false) {
      await thread.post(loadingMessage);
      return;
    }

    try {
      await thread.startTyping(loadingMessage);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[slack:status-error] ${String(error)}`);
      try {
        await thread.post(loadingMessage);
      } catch (fallbackError) {
        // eslint-disable-next-line no-console
        console.error(`[slack:status-fallback-error] ${String(fallbackError)}`);
      }
    }
  }

  public async notifyApproval(thread: GatewayThread, approval: ApprovalRequest): Promise<void> {
    const displayPrompt = toSlackApprovalPrompt(approval.prompt);
    await thread.post(buildApprovalCard(displayPrompt, JSON.stringify(approval)));
  }

  public async notifyCompleted(thread: GatewayThread, message: string): Promise<void> {
    const rendered = renderSlackCompletedMessage(message);

    if (!rendered.text.trim() && rendered.images.length === 0) {
      return;
    }

    if (rendered.images.length === 0) {
      await thread.post({ markdown: rendered.text });
      return;
    }

    const files = await Promise.all(rendered.images.map(async (image) => ({
      data: await readFile(image.path),
      filename: basename(image.path),
    })));
    await thread.post({
      markdown: rendered.text,
      files,
    });
  }

  public async notifyFailed(thread: GatewayThread, message: string): Promise<void> {
    await thread.post(`:warning: ${message}`);
  }

  private async runWorkerFlow(input: {
    thread: GatewayThread;
    action: (onEvent: (event: WorkerRunEvent) => Promise<void>) => Promise<WorkerRunEvent[]>;
    notifyProgress?: boolean;
  }): Promise<WorkerFlowResult> {
    try {
      if (input.notifyProgress !== false) {
        await this.notifyProgress(input.thread, 'thinking...');
      }

      let sawLiveEvent = false;
      let failure: WorkerFlowResult | null = null;
      const events = await input.action(async (event) => {
        sawLiveEvent = true;
        const result = await this.applyWorkerEvent(input.thread, event);
        if (result && !result.ok) {
          failure = result;
        }
      });

      if (!sawLiveEvent) {
        for (const event of events) {
          const result = await this.applyWorkerEvent(input.thread, event);
          if (result && !result.ok) {
            failure = result;
          }
        }
      }

      return failure ?? { ok: true };
    } catch (error) {
      const message = `worker execution failed: ${String(error)}`;
      await this.notifyFailed(input.thread, message);
      return { ok: false, error: message };
    }
  }

  private async applyWorkerEvent(
    thread: GatewayThread,
    event: WorkerRunEvent,
  ): Promise<WorkerFlowResult | null> {
    const state = await this.readThreadState(thread);
    const codexThreadId = state?.codexThreadId ?? '';

    if (event.type === 'progress') {
      await this.notifyProgress(thread, event.message);
      return null;
    }

    if (event.type === 'approval_required') {
      if (codexThreadId) {
        await this.saveThreadState(thread, {
          codexThreadId,
          pendingApprovalId: event.approval_id,
        });
      }
      await this.notifyApproval(thread, {
        approval_id: event.approval_id,
        prompt: event.prompt,
      });
      return null;
    }

    if (event.type === 'completed') {
      if (codexThreadId) {
        await this.saveThreadState(thread, {
          codexThreadId,
          pendingApprovalId: null,
        });
      }
      await this.notifyCompleted(thread, event.message);
      return null;
    }

    await this.notifyFailed(thread, event.error);
    return { ok: false, error: event.error };
  }

  private async clearPendingApprovalIfUnchanged(
    thread: GatewayThread,
    codexThreadId: string,
    approvalId: string,
  ): Promise<void> {
    const state = await this.readThreadState(thread);
    if (state?.codexThreadId !== codexThreadId || state.pendingApprovalId !== approvalId) {
      return;
    }

    await this.saveThreadState(thread, {
      codexThreadId,
      pendingApprovalId: null,
    });
  }

  private async readThreadState(thread: GatewayThread): Promise<ThreadSessionState | null> {
    return await thread.state;
  }

  private async saveThreadState(
    thread: GatewayThread,
    state: ThreadSessionState,
  ): Promise<void> {
    await thread.setState(state, { replace: true });
  }
}

export function toSlackApprovalPrompt(prompt: string): string {
  if (prompt.length <= SLACK_APPROVAL_PROMPT_BLOCK_LIMIT) {
    return prompt;
  }

  return `${prompt.slice(0, SLACK_APPROVAL_PROMPT_BLOCK_LIMIT - 1).trimEnd()}…`;
}


export {
  extractLocalImageFiles,
  renderSlackCompletedMessage,
  toSlackLoadingMessage,
  toSlackMrkdwn,
} from './gateway-renderer.js';
