import type { WorkerRunEvent, WorkerRunOptions } from './types.js';

export interface StreamEvent {
  kind: 'request' | 'notification';
  method: string;
  params: Record<string, unknown>;
  id?: number | string;
  threadId?: string;
  turnId?: string;
}

interface CollectorDeps {
  waitForStreamEvent(match: (event: StreamEvent) => boolean): Promise<StreamEvent>;
  isTurnScopedEvent(event: StreamEvent, threadId: string, turnId: string): boolean;
  buildStreamTimeoutError(error: unknown, lastMatchedEvent: StreamEvent | null): Error;
  tryRegisterApproval(streamEvent: StreamEvent, threadId: string, turnId: string): string | null;
  buildApprovalPrompt(streamEvent: StreamEvent): string;
  buildUnsupportedRequestError(streamEvent: StreamEvent): string;
  emitWorkerEvent(out: WorkerRunEvent[], event: WorkerRunEvent, options?: WorkerRunOptions): Promise<void>;
  shouldEmitDeltaProgress(
    delta: string,
    progressMessage: string,
    lastEmittedProgressMessage: string | null,
  ): boolean;
  asString(value: unknown): string | undefined;
  asRecord(value: unknown): Record<string, unknown>;
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

      if (streamEvent.method === 'item/agentMessage/delta') {
        const delta = this.deps.asString(streamEvent.params.delta);
        if (!delta) {
          continue;
        }

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

      if (streamEvent.method === 'item/completed') {
        const item = this.deps.asRecord(streamEvent.params.item);
        if (this.deps.asString(item.type) === 'agentMessage') {
          const text = this.deps.asString(item.text);
          if (!text) {
            continue;
          }

          const phase = this.deps.asString(item.phase);
          if (phase === 'final_answer') {
            finalMessage = text;
            continue;
          }

          lastProgressMessage = text;
          deltaProgressMessage = text;
          if (text !== lastEmittedProgressMessage) {
            lastEmittedProgressMessage = text;
            await this.deps.emitWorkerEvent(out, { type: 'progress', message: text }, options);
          }
        }
        continue;
      }

      if (streamEvent.method === 'error') {
        continue;
      }

      if (streamEvent.method === 'turn/completed') {
        const turn = this.deps.asRecord(streamEvent.params.turn);
        const status = this.deps.asString(turn.status);
        this.deps.clearActiveTurn(threadId, turnId);

        if (status === 'failed') {
          const turnError = this.deps.asRecord(turn.error);
          const errorMessage = this.deps.asString(turnError.message) ?? 'turn failed';
          await this.deps.emitWorkerEvent(out, { type: 'failed', error: errorMessage }, options);
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
