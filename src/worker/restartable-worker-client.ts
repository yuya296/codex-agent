import type { WorkerClient, WorkerRunEvent, WorkerRunOptions } from './types.js';
import type { ApprovalDecision } from '../domain/types.js';

export class RestartableWorkerClient implements WorkerClient {
  private current: WorkerClient;

  public constructor(
    private readonly factory: () => WorkerClient,
  ) {
    this.current = factory();
  }

  public async restart(): Promise<void> {
    const previous = this.current;
    this.current = this.factory();
    await previous.close();
  }

  public async createThread(): Promise<{ codex_thread_id: string }> {
    return this.current.createThread();
  }

  public async sendUserMessage(
    input: { codex_thread_id: string; text: string; user_id: string },
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]> {
    return this.current.sendUserMessage(input, options);
  }

  public async sendSteerMessage(
    input: { codex_thread_id: string; text: string; user_id: string },
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]> {
    return this.current.sendSteerMessage(input, options);
  }

  public async sendApprovalDecision(
    input: { codex_thread_id: string; approval_id: string; decision: ApprovalDecision },
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]> {
    return this.current.sendApprovalDecision(input, options);
  }

  public async close(): Promise<void> {
    await this.current.close();
  }
}
