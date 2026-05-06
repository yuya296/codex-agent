import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkerClient, WorkerRunEvent, WorkerRunOptions } from '../../src/worker/types.js';
import type { ThreadSessionState } from '../../src/domain/types.js';

export interface ThreadStateLike {
  codexThreadId: string;
  pendingApprovalId: string | null;
}

export function createTempDir(prefix = 'codex-agent-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function createThreadState(overrides: Partial<ThreadStateLike> = {}): ThreadStateLike {
  return {
    codexThreadId: 'thread-1',
    pendingApprovalId: null,
    ...overrides,
  };
}

export class MockWorkerClient implements WorkerClient {
  public readonly callLog: string[] = [];
  public readonly sendUserMessageCalls: Array<{ codex_thread_id: string; text: string; user_id: string }> = [];
  public readonly sendSteerMessageCalls: Array<{ codex_thread_id: string; text: string; user_id: string }> = [];
  public readonly sendApprovalDecisionCalls: Array<{
    codex_thread_id: string;
    approval_id: string;
    decision: 'approve' | 'reject';
  }> = [];

  public createThreadImpl: () => Promise<{ codex_thread_id: string }> = async () => ({
    codex_thread_id: 'thread-1',
  });

  public sendUserMessageImpl: (
    input: { codex_thread_id: string; text: string; user_id: string },
    options?: WorkerRunOptions,
  ) => Promise<WorkerRunEvent[]> = async ({ text }) => [{ type: 'completed', message: `done:${text}` }];

  public sendSteerMessageImpl: (
    input: { codex_thread_id: string; text: string; user_id: string },
    options?: WorkerRunOptions,
  ) => Promise<WorkerRunEvent[]> = async ({ text }) => [{ type: 'completed', message: `steer:${text}` }];

  public sendApprovalDecisionImpl: (input: {
    codex_thread_id: string;
    approval_id: string;
    decision: 'approve' | 'reject';
  }, options?: WorkerRunOptions) => Promise<WorkerRunEvent[]> = async ({ decision }) => [
    { type: 'completed', message: `approval:${decision}` },
  ];

  public async createThread(): Promise<{ codex_thread_id: string }> {
    this.callLog.push('createThread');
    return this.createThreadImpl();
  }

  public async sendUserMessage(input: {
    codex_thread_id: string;
    text: string;
    user_id: string;
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]> {
    this.callLog.push('sendUserMessage');
    this.sendUserMessageCalls.push(input);
    return this.sendUserMessageImpl(input, options);
  }

  public async sendSteerMessage(input: {
    codex_thread_id: string;
    text: string;
    user_id: string;
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]> {
    this.callLog.push('sendSteerMessage');
    this.sendSteerMessageCalls.push(input);
    return this.sendSteerMessageImpl(input, options);
  }

  public async sendApprovalDecision(input: {
    codex_thread_id: string;
    approval_id: string;
    decision: 'approve' | 'reject';
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]> {
    this.callLog.push('sendApprovalDecision');
    this.sendApprovalDecisionCalls.push(input);
    return this.sendApprovalDecisionImpl(input, options);
  }

  public async close(): Promise<void> {
    this.callLog.push('close');
  }
}

export class MockGatewayThread {
  public readonly id = 'slack:D1:100.1';
  public readonly channelId = 'D1';
  public readonly isDM = true;
  public readonly postCalls: unknown[] = [];
  public readonly startTypingCalls: Array<{ status?: string }> = [];
  public readonly setStateCalls: Array<{ state: ThreadSessionState; replace?: boolean }> = [];
  public readonly subscribeCalls: number[] = [];
  public state: ThreadSessionState | null = null;
  public startTypingImpl: (status?: string) => Promise<void> = async () => {};
  public subscribeImpl: () => Promise<void> = async () => {};

  public async post(input: unknown): Promise<void> {
    this.postCalls.push(input);
  }

  public async startTyping(status?: string): Promise<void> {
    this.startTypingCalls.push({ status });
    await this.startTypingImpl(status);
  }

  public async subscribe(): Promise<void> {
    this.subscribeCalls.push(Date.now());
    await this.subscribeImpl();
  }

  public async setState(state: ThreadSessionState, options?: { replace?: boolean }): Promise<void> {
    this.setStateCalls.push({ state, replace: options?.replace });
    this.state = state;
  }
}
