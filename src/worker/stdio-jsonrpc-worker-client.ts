import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ApprovalDecision } from '../domain/types.js';
import type { WorkerClient, WorkerRunEvent } from './types.js';

type JsonRpcId = number | string;

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: { code: number; message: string };
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

type JsonRpcInbound = JsonRpcSuccess | JsonRpcError | JsonRpcRequest | JsonRpcNotification;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface StreamEvent {
  kind: 'request' | 'notification';
  method: string;
  params: Record<string, unknown>;
  id?: JsonRpcId;
  threadId?: string;
  turnId?: string;
}

interface StreamWaiter {
  match: (event: StreamEvent) => boolean;
  resolve: (event: StreamEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface PendingApproval {
  requestId: JsonRpcId;
  method: string;
  threadId: string;
  turnId: string;
}

const METHODS = {
  initialize: 'initialize',
  threadStart: 'thread/start',
  turnStart: 'turn/start',
  turnSteer: 'turn/steer',
  commandApprovalRequest: 'item/commandExecution/requestApproval',
  fileChangeApprovalRequest: 'item/fileChange/requestApproval',
  applyPatchApprovalRequest: 'applyPatchApproval',
  execCommandApprovalRequest: 'execCommandApproval',
  turnCompleted: 'turn/completed',
  itemCompleted: 'item/completed',
  error: 'error',
} as const;

const STREAM_EVENT_TIMEOUT_MS = 5 * 60 * 1000;

export class StdioJsonRpcWorkerClient implements WorkerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly streamBuffer: StreamEvent[] = [];
  private readonly streamWaiters: StreamWaiter[] = [];
  private readonly activeTurnByThread = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private initializePromise: Promise<void> | null = null;

  public constructor(command: string, args: string[] = [], cwd?: string) {
    this.child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
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
    return { codex_thread_id: threadId };
  }

  public async sendUserMessage(input: {
    codex_thread_id: string;
    text: string;
    user_id: string;
  }): Promise<WorkerRunEvent[]> {
    await this.ensureInitialized();

    const result = await this.request<unknown>(METHODS.turnStart, {
      threadId: input.codex_thread_id,
      input: [this.buildTextInput(input.text)],
    });

    const turnId = this.extractTurnIdFromStart(result);
    this.activeTurnByThread.set(input.codex_thread_id, turnId);

    return this.collectTurnEvents(input.codex_thread_id, turnId);
  }

  public async sendSteerMessage(input: {
    codex_thread_id: string;
    text: string;
    user_id: string;
  }): Promise<WorkerRunEvent[]> {
    await this.ensureInitialized();

    const activeTurnId = this.activeTurnByThread.get(input.codex_thread_id);
    if (!activeTurnId) {
      return this.sendUserMessage(input);
    }

    await this.request(METHODS.turnSteer, {
      threadId: input.codex_thread_id,
      expectedTurnId: activeTurnId,
      input: [this.buildTextInput(input.text)],
    });

    // turn/steer 後のイベントは進行中 turn のストリームに乗るため、ここでは非同期反映を待たない。
    return [];
  }

  public async sendApprovalDecision(input: {
    codex_thread_id: string;
    approval_id: string;
    decision: ApprovalDecision;
  }): Promise<WorkerRunEvent[]> {
    await this.ensureInitialized();

    const pendingApproval = this.pendingApprovals.get(input.approval_id);
    if (!pendingApproval) {
      throw new Error(`unknown approval id: ${input.approval_id}`);
    }

    this.pendingApprovals.delete(input.approval_id);

    await this.respondToServerRequest(
      pendingApproval.requestId,
      this.buildApprovalResponse(pendingApproval.method, input.decision),
    );

    return this.collectTurnEvents(pendingApproval.threadId, pendingApproval.turnId);
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

    const event = this.toStreamEvent('notification', parsed.method, parsed.params);
    this.pushStreamEvent(event);
  }

  private toStreamEvent(
    kind: 'request' | 'notification',
    method: string,
    rawParams?: unknown,
    id?: JsonRpcId,
  ): StreamEvent {
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
    const threadId = this.asString(params.threadId);

    const turnIdDirect = this.asString(params.turnId);
    if (turnIdDirect) {
      return { threadId, turnId: turnIdDirect };
    }

    const turn = this.asRecord(params.turn);
    const turnIdFromTurn = this.asString(turn.id);
    return { threadId, turnId: turnIdFromTurn };
  }

  private pushStreamEvent(event: StreamEvent): void {
    const waiterIndex = this.streamWaiters.findIndex((waiter) => waiter.match(event));
    if (waiterIndex >= 0) {
      const [waiter] = this.streamWaiters.splice(waiterIndex, 1);
      if (!waiter) {
        this.streamBuffer.push(event);
        return;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(event);
      return;
    }

    this.streamBuffer.push(event);
  }

  private waitForStreamEvent(match: (event: StreamEvent) => boolean): Promise<StreamEvent> {
    const bufferedIndex = this.streamBuffer.findIndex(match);
    if (bufferedIndex >= 0) {
      const [event] = this.streamBuffer.splice(bufferedIndex, 1);
      if (event) {
        return Promise.resolve(event);
      }
    }

    return new Promise<StreamEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeWaiter(waiter);
        reject(new Error(`timed out waiting for worker stream event (${STREAM_EVENT_TIMEOUT_MS}ms)`));
      }, STREAM_EVENT_TIMEOUT_MS);

      const waiter: StreamWaiter = { match, resolve, reject, timer };
      this.streamWaiters.push(waiter);
    });
  }

  private removeWaiter(target: StreamWaiter): void {
    const index = this.streamWaiters.indexOf(target);
    if (index >= 0) {
      this.streamWaiters.splice(index, 1);
    }
  }

  private async collectTurnEvents(threadId: string, turnId: string): Promise<WorkerRunEvent[]> {
    const out: WorkerRunEvent[] = [];
    let lastProgressMessage: string | null = null;
    let finalMessage: string | null = null;

    while (true) {
      const streamEvent = await this.waitForStreamEvent(
        (event) => event.threadId === threadId && event.turnId === turnId,
      );

      if (streamEvent.kind === 'request') {
        const approvalId = this.tryRegisterApproval(streamEvent);
        if (approvalId) {
          out.push({
            type: 'approval_required',
            approval_id: approvalId,
            prompt: this.buildApprovalPrompt(streamEvent),
          });
          return out;
        }
        continue;
      }

      if (streamEvent.method === METHODS.itemCompleted) {
        const item = this.asRecord(streamEvent.params.item);
        if (this.asString(item.type) === 'agentMessage') {
          const text = this.asString(item.text);
          if (!text) {
            continue;
          }
          const phase = this.asString(item.phase);
          if (phase === 'final_answer') {
            finalMessage = text;
            continue;
          }
          lastProgressMessage = text;
          out.push({ type: 'progress', message: text });
        }
        continue;
      }

      if (streamEvent.method === METHODS.error) {
        const error = this.asRecord(streamEvent.params.error);
        const message = this.asString(error.message) ?? 'worker reported an error';
        this.activeTurnByThread.delete(threadId);
        out.push({ type: 'failed', error: message });
        return out;
      }

      if (streamEvent.method === METHODS.turnCompleted) {
        const turn = this.asRecord(streamEvent.params.turn);
        const status = this.asString(turn.status);
        this.activeTurnByThread.delete(threadId);

        if (status === 'failed') {
          const turnError = this.asRecord(turn.error);
          const errorMessage = this.asString(turnError.message) ?? 'turn failed';
          out.push({ type: 'failed', error: errorMessage });
          return out;
        }

        out.push({
          type: 'completed',
          message: finalMessage ?? lastProgressMessage ?? 'completed',
        });
        return out;
      }
    }
  }

  private tryRegisterApproval(streamEvent: StreamEvent): string | null {
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
      ?? this.asString(streamEvent.params.itemId)
      ?? `request-${String(streamEvent.id ?? '')}`;

    if (!streamEvent.id || !streamEvent.threadId || !streamEvent.turnId) {
      return null;
    }

    this.pendingApprovals.set(approvalId, {
      requestId: streamEvent.id,
      method: streamEvent.method,
      threadId: streamEvent.threadId,
      turnId: streamEvent.turnId,
    });

    return approvalId;
  }

  private buildApprovalPrompt(streamEvent: StreamEvent): string {
    const reason = this.asString(streamEvent.params.reason);
    const command = this.asString(streamEvent.params.command);

    if (reason && command) {
      return `${reason}\n\`${command}\``;
    }

    if (reason) {
      return reason;
    }

    if (command) {
      return `Approval required for command:\n\`${command}\``;
    }

    return 'Approval required to continue.';
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
      jsonrpc: '2.0',
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
      ? JSON.stringify({ jsonrpc: '2.0', method, params })
      : JSON.stringify({ jsonrpc: '2.0', method });

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
      jsonrpc: '2.0',
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

    for (const waiter of this.streamWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}
