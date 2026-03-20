import type { ApprovalDecision } from '../domain/types.js';

export type WorkerRunEvent =
  | { type: 'progress'; message: string }
  | { type: 'approval_required'; approval_id: string; prompt: string }
  | { type: 'completed'; message: string }
  | { type: 'failed'; error: string };

export interface WorkerRunOptions {
  onEvent?: (event: WorkerRunEvent) => Promise<void> | void;
}

export interface WorkerClient {
  createThread(): Promise<{ codex_thread_id: string }>;
  sendUserMessage(
    input: { codex_thread_id: string; text: string; user_id: string },
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]>;
  sendSteerMessage(
    input: { codex_thread_id: string; text: string; user_id: string },
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]>;
  sendApprovalDecision(input: {
    codex_thread_id: string;
    approval_id: string;
    decision: ApprovalDecision;
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]>;
  close(): Promise<void>;
}
