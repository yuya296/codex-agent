import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ApprovalDecision } from '../domain/types.js';
import { ApprovalRegistry } from './approval-registry.js';
import { StreamEventQueue } from './stream-event-queue.js';
import type { WorkerClient, WorkerRunEvent, WorkerRunOptions } from './types.js';
import { TurnEventCollector } from './turn-event-collector.js';
import {
  WorkerProtocolAdapter,
  type JsonRpcId,
  type JsonRpcInbound,
  type StreamEvent,
} from './worker-protocol-adapter.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type WorkerStreamEvent = StreamEvent & { id?: JsonRpcId };

interface WorkerClientOptions {
  streamEventTimeoutMs?: number;
  debugEvents?: boolean;
  debugDeltaEvents?: boolean;
}

const DEFAULT_STREAM_EVENT_TIMEOUT_MS = 5 * 60 * 1000;
const IGNORED_STDERR_PATTERNS = [
  'failed to refresh available models: timeout waiting for child process to exit',
] as const;

export class StdioJsonRpcWorkerClient implements WorkerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly protocol: WorkerProtocolAdapter;
  private readonly streamEventQueue: StreamEventQueue<WorkerStreamEvent>;
  private readonly loadedThreads = new Set<string>();
  private readonly activeTurnByThread = new Map<string, string>();
  private readonly activeThreadByTurn = new Map<string, string>();
  private readonly approvalRegistry = new ApprovalRegistry();
  private initializePromise: Promise<void> | null = null;
  private readonly streamEventTimeoutMs: number;
  private readonly debugEvents: boolean;
  private readonly debugDeltaEvents: boolean;
  private readonly turnEventCollector: TurnEventCollector;

  public constructor(command: string, args: string[] = [], cwd?: string, options: WorkerClientOptions = {}) {
    this.child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.streamEventTimeoutMs = options.streamEventTimeoutMs ?? DEFAULT_STREAM_EVENT_TIMEOUT_MS;
    this.debugEvents = options.debugEvents ?? false;
    this.debugDeltaEvents = options.debugDeltaEvents ?? false;
    this.protocol = new WorkerProtocolAdapter((turnId) => this.activeThreadByTurn.get(turnId));
    this.streamEventQueue = new StreamEventQueue<WorkerStreamEvent>(this.streamEventTimeoutMs);
    this.turnEventCollector = new TurnEventCollector({
      waitForStreamEvent: async (match) => this.waitForStreamEvent(match),
      isTurnScopedEvent: (event, threadId, turnId) => this.isTurnScopedEvent(event, threadId, turnId),
      buildStreamTimeoutError: (error, lastMatchedEvent) => this.buildStreamTimeoutError(error, lastMatchedEvent),
      tryRegisterApproval: (streamEvent, threadId, turnId) => this.tryRegisterApproval(streamEvent, threadId, turnId),
      buildUnsupportedRequestError: (streamEvent) => this.buildUnsupportedRequestError(streamEvent),
      emitWorkerEvent: async (out, event, runOptions) => this.emitWorkerEvent(out, event, runOptions),
      shouldEmitDeltaProgress: (delta, progressMessage, lastEmittedProgressMessage) => this.shouldEmitDeltaProgress(
        delta,
        progressMessage,
        lastEmittedProgressMessage,
      ),
      buildApprovalPrompt: (streamEvent) => this.protocol.buildApprovalPrompt(streamEvent),
      readAgentMessageDelta: (event) => this.protocol.readAgentMessageDelta(event),
      readCompletedAgentMessage: (event) => this.protocol.readCompletedAgentMessage(event),
      isErrorEvent: (event) => this.protocol.isErrorEvent(event),
      readTurnCompletion: (event) => this.protocol.readTurnCompletion(event),
      clearActiveTurn: (threadId, turnId) => {
        this.activeTurnByThread.delete(threadId);
        this.activeThreadByTurn.delete(turnId);
      },
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      try {
        const parsed = JSON.parse(line) as JsonRpcInbound;
        this.handleInbound(parsed);
      } catch (error) {
        this.failAll(new Error(`failed to parse worker jsonrpc line: ${String(error)}`));
      }
    });

    this.child.on('exit', (code) => {
      this.failAll(new Error(`worker exited unexpectedly with code ${code ?? 'null'}`));
    });

    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text.length > 0) {
        if (IGNORED_STDERR_PATTERNS.some((pattern) => text.includes(pattern))) {
          return;
        }
        // eslint-disable-next-line no-console
        console.error(`[worker] ${text}`);
      }
    });
  }

  public async createThread(): Promise<{ codex_thread_id: string }> {
    await this.ensureInitialized();

    const result = await this.request<unknown>(this.protocol.methods.threadStart, {
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    const threadId = this.protocol.extractThreadId(result);
    this.loadedThreads.add(threadId);
    return { codex_thread_id: threadId };
  }

  public async sendUserMessage(input: {
    codex_thread_id: string;
    text: string;
    user_id: string;
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]> {
    await this.ensureInitialized();
    await this.ensureThreadLoaded(input.codex_thread_id);

    const result = await this.request<unknown>(this.protocol.methods.turnStart, {
      threadId: input.codex_thread_id,
      input: [this.protocol.buildTextInput(input.text)],
    });

    const turnId = this.protocol.extractTurnIdFromStart(result);
    this.activeTurnByThread.set(input.codex_thread_id, turnId);
    this.activeThreadByTurn.set(turnId, input.codex_thread_id);

    return this.collectTurnEvents(input.codex_thread_id, turnId, options);
  }

  public async sendSteerMessage(input: {
    codex_thread_id: string;
    text: string;
    user_id: string;
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]> {
    await this.ensureInitialized();
    await this.ensureThreadLoaded(input.codex_thread_id);

    const activeTurnId = this.activeTurnByThread.get(input.codex_thread_id);
    if (!activeTurnId) {
      return this.sendUserMessage(input, options);
    }

    await this.request(this.protocol.methods.turnSteer, {
      threadId: input.codex_thread_id,
      expectedTurnId: activeTurnId,
      input: [this.protocol.buildTextInput(input.text)],
    });

    return this.collectTurnEvents(input.codex_thread_id, activeTurnId, options);
  }

  public async sendApprovalDecision(input: {
    codex_thread_id: string;
    approval_id: string;
    decision: ApprovalDecision;
  }, options?: WorkerRunOptions): Promise<WorkerRunEvent[]> {
    await this.ensureInitialized();

    const pendingApproval = this.approvalRegistry.consume(input.approval_id);
    if (!pendingApproval) {
      throw new Error(`unknown approval id: ${input.approval_id}`);
    }

    await this.respondToServerRequest(
      pendingApproval.requestId,
      this.protocol.buildApprovalResponse(pendingApproval.method, input.decision),
    );

    return this.collectTurnEvents(pendingApproval.threadId, pendingApproval.turnId, options);
  }

  public async close(): Promise<void> {
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize();
    }
    await this.initializePromise;
  }

  private async initialize(): Promise<void> {
    await this.request(this.protocol.methods.initialize, {
      clientInfo: {
        name: 'codex-agent',
        title: 'Codex Agent',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    await this.notify(this.protocol.methods.initialized);
  }

  private handleInbound(parsed: JsonRpcInbound): void {
    if (this.protocol.isJsonRpcResponse(parsed)) {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      this.pending.delete(parsed.id);

      if ('error' in parsed) {
        pending.reject(new Error(parsed.error.message));
        return;
      }

      pending.resolve(parsed.result);
      return;
    }

    if ('id' in parsed) {
      const event = this.protocol.toStreamEvent('request', parsed.method, parsed.params, parsed.id);
      this.pushStreamEvent(event);
      return;
    }

    if (parsed.method === this.protocol.methods.threadClosed) {
      const threadId = this.protocol.extractClosedThreadId(parsed.params);
      if (threadId) {
        this.loadedThreads.delete(threadId);
        this.activeTurnByThread.delete(threadId);
      }
    }

    const event = this.protocol.toStreamEvent('notification', parsed.method, parsed.params);
    this.pushStreamEvent(event);
  }

  private async ensureThreadLoaded(threadId: string): Promise<void> {
    if (this.loadedThreads.has(threadId)) {
      return;
    }

    await this.request(this.protocol.methods.threadResume, { threadId });
    this.loadedThreads.add(threadId);
  }

  private pushStreamEvent(event: WorkerStreamEvent): void {
    this.logStreamEvent(event);
    this.streamEventQueue.push(event);
  }

  private waitForStreamEvent(match: (event: StreamEvent) => boolean): Promise<WorkerStreamEvent> {
    return this.streamEventQueue.waitFor(match);
  }

  private isTurnScopedEvent(event: StreamEvent, threadId: string, turnId: string): boolean {
    const threadMatches = !event.threadId || event.threadId === threadId;
    if (!threadMatches) {
      return false;
    }

    if (event.turnId === turnId) {
      return true;
    }

    return event.kind === 'request' && !event.turnId;
  }

  private async collectTurnEvents(
    threadId: string,
    turnId: string,
    options?: WorkerRunOptions,
  ): Promise<WorkerRunEvent[]> {
    return this.turnEventCollector.collect(threadId, turnId, options);
  }

  private async emitWorkerEvent(
    out: WorkerRunEvent[],
    event: WorkerRunEvent,
    options?: WorkerRunOptions,
  ): Promise<void> {
    out.push(event);
    await options?.onEvent?.(event);
  }

  private shouldEmitDeltaProgress(
    delta: string,
    progressMessage: string,
    lastEmittedProgressMessage: string | null,
  ): boolean {
    if (!progressMessage) {
      return false;
    }

    if (progressMessage === lastEmittedProgressMessage) {
      return false;
    }

    if (!lastEmittedProgressMessage) {
      return progressMessage.length >= 8 || /[。！？\n]/u.test(delta);
    }

    const growth = progressMessage.length - lastEmittedProgressMessage.length;
    return growth >= 12 || /[。！？\n]/u.test(delta);
  }

  private tryRegisterApproval(
    streamEvent: WorkerStreamEvent,
    fallbackThreadId?: string,
    fallbackTurnId?: string,
  ): string | null {
    if (!this.protocol.isApprovalRequestMethod(streamEvent.method)) {
      return null;
    }

    const resolvedThreadId = streamEvent.threadId ?? fallbackThreadId;
    const resolvedTurnId = streamEvent.turnId ?? fallbackTurnId;

    if (streamEvent.id === undefined || streamEvent.id === null || !resolvedThreadId || !resolvedTurnId) {
      return null;
    }

    const approvalId = this.protocol.resolveApprovalId(streamEvent);
    this.approvalRegistry.register(approvalId, {
      requestId: streamEvent.id,
      method: streamEvent.method,
      threadId: resolvedThreadId,
      turnId: resolvedTurnId,
    });

    return approvalId;
  }

  private buildUnsupportedRequestError(streamEvent: StreamEvent): string {
    const details = this.protocol.summarizeEvent(streamEvent);
    return `worker requested unsupported client interaction: ${streamEvent.method}${details ? ` (${details})` : ''}`;
  }

  private buildStreamTimeoutError(error: unknown, lastMatchedEvent: StreamEvent | null): Error {
    const baseMessage = error instanceof Error ? error.message : String(error);
    if (!baseMessage.includes('timed out waiting for worker stream event')) {
      return error instanceof Error ? error : new Error(baseMessage);
    }

    if (!lastMatchedEvent) {
      return new Error(`${baseMessage}; no turn-scoped worker event was received before timeout`);
    }

    const details = this.protocol.summarizeEvent(lastMatchedEvent);
    return new Error(
      `${baseMessage}; last turn event was ${lastMatchedEvent.kind}:${lastMatchedEvent.method}${details ? ` (${details})` : ''}`,
    );
  }

  private logStreamEvent(event: StreamEvent): void {
    if (!this.debugEvents) {
      return;
    }

    if (this.protocol.isNoisyDeltaMethod(event.method) && !this.debugDeltaEvents) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[worker:event]', JSON.stringify({
      kind: event.kind,
      method: event.method,
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
      details: this.protocol.summarizeEvent(event) || null,
    }));
  }

  private request<T>(method: string, params: object): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({
      id,
      method,
      params,
    });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      this.child.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private notify(method: string, params?: object): Promise<void> {
    const payload = params
      ? JSON.stringify({ method, params })
      : JSON.stringify({ method });

    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  private respondToServerRequest(id: JsonRpcId, result: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify({
      id,
      result,
    });

    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      this.pending.delete(id);
      entry.reject(error);
    }

    this.streamEventQueue.failAll(error);
  }
}
