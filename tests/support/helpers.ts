import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { GatewayNotifier } from '../../src/orchestrator/orchestrator.js';
import type { WorkerClient, WorkerRunEvent, WorkerRunOptions } from '../../src/worker/types.js';

export function createTempDir(prefix = 'codex-agent-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
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

export class MockNotifier implements GatewayNotifier {
  public readonly progressMessages: string[] = [];
  public readonly approvalEvents: Array<{ approval_id: string; prompt: string }> = [];
  public readonly completedMessages: string[] = [];
  public readonly failedMessages: string[] = [];

  public async notifyProgress(_session: unknown, message: string): Promise<void> {
    this.progressMessages.push(message);
  }

  public async notifyApproval(
    _session: unknown,
    approval: { approval_id: string; prompt: string },
  ): Promise<void> {
    this.approvalEvents.push(approval);
  }

  public async notifyCompleted(_session: unknown, message: string): Promise<void> {
    this.completedMessages.push(message);
  }

  public async notifyFailed(_session: unknown, message: string): Promise<void> {
    this.failedMessages.push(message);
  }
}
