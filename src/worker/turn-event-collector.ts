import type { WorkerRunEvent, WorkerRunOptions } from './types.js';
import type { StreamEvent } from './worker-protocol-adapter.js';

interface CollectorDeps {
  waitForStreamEvent(match: (event: StreamEvent) => boolean): Promise<StreamEvent>;
  isTurnScopedEvent(event: StreamEvent, threadId: string, turnId: string): boolean;
  buildStreamTimeoutError(error: unknown, lastMatchedEvent: StreamEvent | null): Error;
  tryRegisterApproval(streamEvent: StreamEvent, threadId: string, turnId: string): string | null;
  buildUnsupportedRequestError(streamEvent: StreamEvent): string;
  emitWorkerEvent(out: WorkerRunEvent[], event: WorkerRunEvent, options?: WorkerRunOptions): Promise<void>;
  shouldEmitDeltaProgress(
    delta: string,
    progressMessage: string,
    lastEmittedProgressMessage: string | null,
  ): boolean;
  buildApprovalPrompt(streamEvent: StreamEvent): string;
  readAgentMessageDelta(event: StreamEvent): string | null;
  readCompletedAgentMessage(event: StreamEvent): { text: string; phase: string | null } | null;
  isErrorEvent(event: StreamEvent): boolean;
  readTurnCompletion(event: StreamEvent): { status: string | null; errorMessage: string } | null;
  clearActiveTurn(threadId: string, turnId: string): void;
}

export class TurnEventCollector {
  public constructor(private readonly deps: CollectorDeps) {}

  public async collect(
    threadId: string,
    turnId: string,
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]> {
    const out: WorkerRunEvent[] = [];
    let lastProgressMessage: string | null = null;
    let finalMessage: string | null = null;
    let lastMatchedEvent: StreamEvent | null = null;
    let deltaProgressMessage = '';
    let lastEmittedProgressMessage: string | null = null;

    while (true) {
      let streamEvent: StreamEvent;
      try {
        streamEvent = await this.deps.waitForStreamEvent(
          (event) => this.deps.isTurnScopedEvent(event, threadId, turnId),
        );
      } catch (error) {
        throw this.deps.buildStreamTimeoutError(error, lastMatchedEvent);
      }
      lastMatchedEvent = streamEvent;

      if (streamEvent.kind === 'request') {
        const approvalId = this.deps.tryRegisterApproval(streamEvent, threadId, turnId);
        if (approvalId) {
          await this.deps.emitWorkerEvent(out, {
            type: 'approval_required',
            approval_id: approvalId,
            prompt: this.deps.buildApprovalPrompt(streamEvent),
          }, options);
          return out;
        }

        this.deps.clearActiveTurn(threadId, turnId);
        await this.deps.emitWorkerEvent(out, {
          type: 'failed',
          error: this.deps.buildUnsupportedRequestError(streamEvent),
        }, options);
        return out;
      }

      const delta = this.deps.readAgentMessageDelta(streamEvent);
      if (delta) {
        deltaProgressMessage += delta;
        const progressMessage = deltaProgressMessage.trim();
        if (!this.deps.shouldEmitDeltaProgress(delta, progressMessage, lastEmittedProgressMessage)) {
          continue;
        }

        lastProgressMessage = progressMessage;
        lastEmittedProgressMessage = progressMessage;
        await this.deps.emitWorkerEvent(out, { type: 'progress', message: progressMessage }, options);
        continue;
      }

      const completedAgentMessage = this.deps.readCompletedAgentMessage(streamEvent);
      if (completedAgentMessage) {
        if (completedAgentMessage.phase === 'final_answer') {
          finalMessage = completedAgentMessage.text;
          continue;
        }

        lastProgressMessage = completedAgentMessage.text;
        deltaProgressMessage = completedAgentMessage.text;
        if (completedAgentMessage.text !== lastEmittedProgressMessage) {
          lastEmittedProgressMessage = completedAgentMessage.text;
          await this.deps.emitWorkerEvent(out, { type: 'progress', message: completedAgentMessage.text }, options);
        }
        continue;
      }

      if (this.deps.isErrorEvent(streamEvent)) {
        continue;
      }

      const turnCompletion = this.deps.readTurnCompletion(streamEvent);
      if (turnCompletion) {
        this.deps.clearActiveTurn(threadId, turnId);

        if (turnCompletion.status === 'failed') {
          await this.deps.emitWorkerEvent(out, { type: 'failed', error: turnCompletion.errorMessage }, options);
          return out;
        }

        await this.deps.emitWorkerEvent(out, {
          type: 'completed',
          message: finalMessage ?? lastProgressMessage ?? 'completed',
        }, options);
        return out;
      }
    }
  }
}
