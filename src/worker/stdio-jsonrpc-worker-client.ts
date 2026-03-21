import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ApprovalDecision } from '../domain/types.js';
import { ApprovalRegistry } from './approval-registry.js';
import { StreamEventQueue } from './stream-event-queue.js';
import type { WorkerClient, WorkerRunEvent, WorkerRunOptions } from './types.js';
import { TurnEventCollector, type StreamEvent } from './turn-event-collector.js';

type JsonRpcId = number | string;

interface JsonRpcSuccess {
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcError {
  id: JsonRpcId;
  error: { code: number; message: string };
}

interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

type JsonRpcInbound = JsonRpcSuccess | JsonRpcError | JsonRpcRequest | JsonRpcNotification;

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

const METHODS = {
  initialize: 'initialize',
  threadStart: 'thread/start',
  threadResume: 'thread/resume',
  threadClosed: 'thread/closed',
  turnStart: 'turn/start',
  turnSteer: 'turn/steer',
  commandApprovalRequest: 'item/commandExecution/requestApproval',
  fileChangeApprovalRequest: 'item/fileChange/requestApproval',
  applyPatchApprovalRequest: 'applyPatchApproval',
  execCommandApprovalRequest: 'execCommandApproval',
  requestUserInput: 'item/tool/requestUserInput',
  elicitationRequest: 'mcpServer/elicitation/request',
  dynamicToolCall: 'item/tool/call',
  authRefreshRequest: 'account/chatgptAuthTokens/refresh',
  turnCompleted: 'turn/completed',
  itemCompleted: 'item/completed',
  error: 'error',
} as const;
const DEFAULT_STREAM_EVENT_TIMEOUT_MS = 5 * 60 * 1000;
const IGNORED_STDERR_PATTERNS = [
  'failed to refresh available models: timeout waiting for child process to exit',
] as const;
const NOISY_DELTA_METHODS = new Set<string>([
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
]);

export class StdioJsonRpcWorkerClient implements WorkerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
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
    this.streamEventQueue = new StreamEventQueue<WorkerStreamEvent>(this.streamEventTimeoutMs);
    this.turnEventCollector = new TurnEventCollector({
      waitForStreamEvent: async (match) => this.waitForStreamEvent(match),
      isTurnScopedEvent: (event, threadId, turnId) => this.isTurnScopedEvent(event, threadId, turnId),
      buildStreamTimeoutError: (error, lastMatchedEvent) => this.buildStreamTimeoutError(error, lastMatchedEvent),
      tryRegisterApproval: (streamEvent, threadId, turnId) => this.tryRegisterApproval(streamEvent, threadId, turnId),
      buildApprovalPrompt: (streamEvent) => this.buildApprovalPrompt(streamEvent),
      buildUnsupportedRequestError: (streamEvent) => this.buildUnsupportedRequestError(streamEvent),
      emitWorkerEvent: async (out, event, runOptions) => this.emitWorkerEvent(out, event, runOptions),
      shouldEmitDeltaProgress: (delta, progressMessage, lastEmittedProgressMessage) => this.shouldEmitDeltaProgress(
        delta,
        progressMessage,
        lastEmittedProgressMessage,
      ),
      asString: (value) => this.asString(value),
      asRecord: (value) => this.asRecord(value),
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

    const result = await this.request<unknown>(METHODS.threadStart, {
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    const threadId = this.extractThreadId(result);
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

    const result = await this.request<unknown>(METHODS.turnStart, {
      threadId: input.codex_thread_id,
      input: [this.buildTextInput(input.text)],
    });

    const turnId = this.extractTurnIdFromStart(result);
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

    await this.request(METHODS.turnSteer, {
      threadId: input.codex_thread_id,
      expectedTurnId: activeTurnId,
      input: [this.buildTextInput(input.text)],
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
      this.buildApprovalResponse(pendingApproval.method, input.decision),
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
    await this.request(METHODS.initialize, {
      clientInfo: {
        name: 'codex-agent',
        title: 'Codex Agent',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    await this.notify('initialized');
  }

  private handleInbound(parsed: JsonRpcInbound): void {
    if (this.isJsonRpcResponse(parsed)) {
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
      const event = this.toStreamEvent('request', parsed.method, parsed.params, parsed.id);
      this.pushStreamEvent(event);
      return;
    }

    if (parsed.method === METHODS.threadClosed) {
      const params = this.asRecord(parsed.params);
      const threadId = this.asString(params.threadId);
      if (threadId) {
        this.loadedThreads.delete(threadId);
        this.activeTurnByThread.delete(threadId);
      }
    }

    const event = this.toStreamEvent('notification', parsed.method, parsed.params);
    this.pushStreamEvent(event);
  }

  private async ensureThreadLoaded(threadId: string): Promise<void> {
    if (this.loadedThreads.has(threadId)) {
      return;
    }

    await this.request(METHODS.threadResume, { threadId });
    this.loadedThreads.add(threadId);
  }

  private toStreamEvent(
    kind: 'request' | 'notification',
    method: string,
    rawParams?: unknown,
    id?: JsonRpcId,
  ): WorkerStreamEvent {
    const params = this.asRecord(rawParams);
    const { threadId, turnId } = this.extractThreadAndTurn(params);

    return {
      kind,
      method,
      params,
      id,
      threadId,
      turnId,
    };
  }

  private extractThreadAndTurn(params: Record<string, unknown>): {
    threadId?: string;
    turnId?: string;
  } {
    let threadId = this.asString(params.threadId) ?? this.asString(params.thread_id);

    const turnIdDirect = this.asString(params.turnId) ?? this.asString(params.turn_id);
    if (turnIdDirect) {
      if (!threadId) {
        threadId = this.activeThreadByTurn.get(turnIdDirect);
      }
      return { threadId, turnId: turnIdDirect };
    }

    const turn = this.asRecord(params.turn);
    const turnIdFromTurn = this.asString(turn.id);
    if (turnIdFromTurn && !threadId) {
      threadId = this.activeThreadByTurn.get(turnIdFromTurn);
    }
    return { threadId, turnId: turnIdFromTurn };
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
    if (
      streamEvent.method !== METHODS.commandApprovalRequest
      && streamEvent.method !== METHODS.fileChangeApprovalRequest
      && streamEvent.method !== METHODS.execCommandApprovalRequest
      && streamEvent.method !== METHODS.applyPatchApprovalRequest
    ) {
      return null;
    }

    const approvalId =
      this.asString(streamEvent.params.approvalId)
      ?? this.asString(streamEvent.params.approval_id)
      ?? this.asString(streamEvent.params.itemId)
      ?? this.asString(streamEvent.params.item_id)
      ?? `request-${String(streamEvent.id ?? '')}`;

    const resolvedThreadId = streamEvent.threadId ?? fallbackThreadId;
    const resolvedTurnId = streamEvent.turnId ?? fallbackTurnId;

    if (streamEvent.id === undefined || streamEvent.id === null || !resolvedThreadId || !resolvedTurnId) {
      return null;
    }

    this.approvalRegistry.register(approvalId, {
      requestId: streamEvent.id,
      method: streamEvent.method,
      threadId: resolvedThreadId,
      turnId: resolvedTurnId,
    });

    return approvalId;
  }

  private buildApprovalPrompt(streamEvent: StreamEvent): string {
    const reason = this.asString(streamEvent.params.reason);
    const command = this.readCommand(streamEvent.params.command);

    if (reason && command) {
      return `${reason}\n${this.formatCommandCodeBlock(command)}`;
    }

    if (reason) {
      return reason;
    }

    if (command) {
      return `Approval required for command:\n${this.formatCommandCodeBlock(command)}`;
    }

    return 'Approval required to continue.';
  }

  private formatCommandCodeBlock(command: string): string {
    return `\`\`\`\n${command}\n\`\`\``;
  }

  private readCommand(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      const parts = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
      if (parts.length > 0) {
        return parts.join(' ');
      }
    }

    return null;
  }

  private buildUnsupportedRequestError(streamEvent: StreamEvent): string {
    const details = this.summarizeEvent(streamEvent);
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

    const details = this.summarizeEvent(lastMatchedEvent);
    return new Error(
      `${baseMessage}; last turn event was ${lastMatchedEvent.kind}:${lastMatchedEvent.method}${details ? ` (${details})` : ''}`,
    );
  }

  private summarizeEvent(event: StreamEvent): string {
    const topLevelMessage = this.asString(event.params.message);
    if (topLevelMessage) {
      return this.truncate(topLevelMessage);
    }

    const errorObject = this.asRecord(event.params.error);
    const errorMessage = this.asString(errorObject.message);
    if (errorMessage) {
      return this.truncate(errorMessage);
    }

    const errorString = this.asString(event.params.error);
    if (errorString) {
      return this.truncate(errorString);
    }

    const delta = this.asString(event.params.delta);
    if (delta) {
      return this.truncate(delta);
    }

    const reason = this.asString(event.params.reason);
    const command = this.asString(event.params.command);
    if (reason && command) {
      return this.truncate(`${reason}; command=${command}`);
    }
    if (reason) {
      return this.truncate(reason);
    }
    if (command) {
      return this.truncate(`command=${command}`);
    }

    const questions = Array.isArray(event.params.questions) ? event.params.questions.length : null;
    if (questions !== null) {
      return `${questions} question(s)`;
    }

    const item = this.asRecord(event.params.item);
    const itemType = this.asString(item.type);
    const itemText = this.asString(item.text);
    if (itemType && itemText) {
      return this.truncate(`${itemType}:${itemText}`);
    }
    if (itemType) {
      return itemType;
    }

    const status = this.asString(this.asRecord(event.params.turn).status);
    if (status) {
      return `status=${status}`;
    }

    return '';
  }

  private truncate(text: string, max = 120): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }

  private logStreamEvent(event: StreamEvent): void {
    if (!this.debugEvents) {
      return;
    }

    if (NOISY_DELTA_METHODS.has(event.method) && !this.debugDeltaEvents) {
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[worker:event]', JSON.stringify({
      kind: event.kind,
      method: event.method,
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
      details: this.summarizeEvent(event) || null,
    }));
  }

  private buildApprovalResponse(method: string, decision: ApprovalDecision): Record<string, unknown> {
    const approve = decision === 'approve';

    if (method === METHODS.commandApprovalRequest || method === METHODS.fileChangeApprovalRequest) {
      return {
        decision: approve ? 'accept' : 'decline',
      };
    }

    if (method === METHODS.execCommandApprovalRequest || method === METHODS.applyPatchApprovalRequest) {
      return {
        decision: approve ? 'approved' : 'denied',
      };
    }

    throw new Error(`unsupported approval method: ${method}`);
  }

  private extractThreadId(result: unknown): string {
    const root = this.asRecord(result);
    const thread = this.asRecord(root.thread);
    const threadId = this.asString(thread.id);

    if (!threadId) {
      throw new Error('thread/start response did not include thread.id');
    }

    return threadId;
  }

  private extractTurnIdFromStart(result: unknown): string {
    const root = this.asRecord(result);
    const turn = this.asRecord(root.turn);
    const fromTurn = this.asString(turn.id);
    if (fromTurn) {
      return fromTurn;
    }

    const fromTurnId = this.asString(root.turnId);
    if (fromTurnId) {
      return fromTurnId;
    }

    throw new Error('turn response did not include turn id');
  }

  private buildTextInput(text: string): Record<string, unknown> {
    return {
      type: 'text',
      text,
      text_elements: [],
    };
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

  private isJsonRpcResponse(value: JsonRpcInbound): value is JsonRpcSuccess | JsonRpcError {
    return 'id' in value && !('method' in value);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private asString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }
    return undefined;
  }

  private failAll(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      this.pending.delete(id);
      entry.reject(error);
    }

    this.streamEventQueue.failAll(error);
  }
}
