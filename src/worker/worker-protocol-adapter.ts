import type { ApprovalDecision } from '../domain/types.js';

export type JsonRpcId = number | string;

export interface JsonRpcSuccess {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  id: JsonRpcId;
  error: { code: number; message: string };
}

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export type JsonRpcInbound = JsonRpcSuccess | JsonRpcError | JsonRpcRequest | JsonRpcNotification;

export interface StreamEvent {
  kind: 'request' | 'notification';
  method: string;
  params: Record<string, unknown>;
  id?: JsonRpcId;
  threadId?: string;
  turnId?: string;
}

const METHODS = {
  initialize: 'initialize',
  initialized: 'initialized',
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
  agentMessageDelta: 'item/agentMessage/delta',
  turnCompleted: 'turn/completed',
  itemCompleted: 'item/completed',
  error: 'error',
} as const;

const NOISY_DELTA_METHODS = new Set<string>([
  METHODS.agentMessageDelta,
  'item/plan/delta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
]);

export class WorkerProtocolAdapter {
  public readonly methods = METHODS;

  public constructor(
    private readonly resolveThreadIdByTurn: (turnId: string) => string | undefined,
  ) {}

  public isJsonRpcResponse(value: JsonRpcInbound): value is JsonRpcSuccess | JsonRpcError {
    return 'id' in value && !('method' in value);
  }

  public toStreamEvent(
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

  public extractClosedThreadId(rawParams: unknown): string | null {
    return this.asString(this.asRecord(rawParams).threadId) ?? null;
  }

  public extractThreadId(result: unknown): string {
    const root = this.asRecord(result);
    const thread = this.asRecord(root.thread);
    const threadId = this.asString(thread.id);

    if (!threadId) {
      throw new Error('thread/start response did not include thread.id');
    }

    return threadId;
  }

  public extractTurnIdFromStart(result: unknown): string {
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

  public buildTextInput(text: string): Record<string, unknown> {
    return {
      type: 'text',
      text,
      text_elements: [],
    };
  }

  public isNoisyDeltaMethod(method: string): boolean {
    return NOISY_DELTA_METHODS.has(method);
  }

  public isApprovalRequestMethod(method: string): boolean {
    return (
      method === METHODS.commandApprovalRequest
      || method === METHODS.fileChangeApprovalRequest
      || method === METHODS.execCommandApprovalRequest
      || method === METHODS.applyPatchApprovalRequest
    );
  }

  public supportsApprovalStyleElicitation(event: StreamEvent): boolean {
    if (event.method !== METHODS.elicitationRequest) {
      return false;
    }

    const mode = this.asString(event.params.mode);
    if (mode === 'url') {
      return true;
    }

    const requestedSchema = this.asRecord(event.params.requestedSchema);
    const properties = this.asRecord(requestedSchema.properties);
    const entries = Object.entries(properties);
    if (entries.length === 0) {
      return true;
    }

    return entries.every(([, definition]) => this.asString(this.asRecord(definition).type) === 'boolean');
  }

  public resolveApprovalId(event: StreamEvent): string {
    return (
      this.asString(event.params.approvalId)
      ?? this.asString(event.params.approval_id)
      ?? this.asString(event.params.elicitationId)
      ?? this.asString(event.params.elicitation_id)
      ?? this.asString(event.params.itemId)
      ?? this.asString(event.params.item_id)
      ?? `request-${String(event.id ?? '')}`
    );
  }

  public buildApprovalPrompt(event: StreamEvent): string {
    if (event.method === METHODS.elicitationRequest) {
      return this.buildElicitationPrompt(event.params);
    }

    const reason = this.asString(event.params.reason);
    const command = this.readCommand(event.params.command);

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

  public buildApprovalResponse(
    method: string,
    decision: ApprovalDecision,
    params: Record<string, unknown> = {},
  ): Record<string, unknown> {
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

    if (method === METHODS.elicitationRequest) {
      return this.buildElicitationResponse(decision, params);
    }

    throw new Error(`unsupported approval method: ${method}`);
  }

  public summarizeEvent(event: StreamEvent): string {
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

  public readAgentMessageDelta(event: StreamEvent): string | null {
    if (event.method !== METHODS.agentMessageDelta) {
      return null;
    }

    return this.asString(event.params.delta) ?? null;
  }

  public readCompletedAgentMessage(
    event: StreamEvent,
  ): { text: string; phase: string | null } | null {
    if (event.method !== METHODS.itemCompleted) {
      return null;
    }

    const item = this.asRecord(event.params.item);
    if (this.asString(item.type) !== 'agentMessage') {
      return null;
    }

    const text = this.asString(item.text);
    if (!text) {
      return null;
    }

    return {
      text,
      phase: this.asString(item.phase) ?? null,
    };
  }

  public isErrorEvent(event: StreamEvent): boolean {
    return event.method === METHODS.error;
  }

  public readTurnCompletion(
    event: StreamEvent,
  ): { status: string | null; errorMessage: string } | null {
    if (event.method !== METHODS.turnCompleted) {
      return null;
    }

    const turn = this.asRecord(event.params.turn);
    const turnError = this.asRecord(turn.error);

    return {
      status: this.asString(turn.status) ?? null,
      errorMessage: this.asString(turnError.message) ?? 'turn failed',
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
        threadId = this.resolveThreadIdByTurn(turnIdDirect);
      }
      return { threadId, turnId: turnIdDirect };
    }

    const turn = this.asRecord(params.turn);
    const turnIdFromTurn = this.asString(turn.id);
    if (turnIdFromTurn && !threadId) {
      threadId = this.resolveThreadIdByTurn(turnIdFromTurn);
    }
    return { threadId, turnId: turnIdFromTurn };
  }

  private formatCommandCodeBlock(command: string): string {
    return `\`\`\`\n${command}\n\`\`\``;
  }

  private buildElicitationPrompt(params: Record<string, unknown>): string {
    const message = this.asString(params.message) ?? 'User confirmation is required to continue.';
    const mode = this.asString(params.mode);
    const url = this.asString(params.url);

    if (mode === 'url' && url) {
      return `${message}\n${url}`;
    }

    return message;
  }

  private buildElicitationResponse(
    decision: ApprovalDecision,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    if (decision === 'reject') {
      return { action: 'decline' };
    }

    const mode = this.asString(params.mode);
    if (mode === 'url') {
      return { action: 'accept' };
    }

    const content = this.buildBooleanElicitationContent(params, true);
    if (content) {
      return {
        action: 'accept',
        content,
      };
    }

    return { action: 'accept' };
  }

  private buildBooleanElicitationContent(
    params: Record<string, unknown>,
    value: boolean,
  ): Record<string, boolean> | null {
    const requestedSchema = this.asRecord(params.requestedSchema);
    const properties = this.asRecord(requestedSchema.properties);
    const entries = Object.entries(properties);

    if (entries.length === 0) {
      return null;
    }

    const content: Record<string, boolean> = {};
    for (const [key, definition] of entries) {
      if (this.asString(this.asRecord(definition).type) !== 'boolean') {
        return null;
      }
      content[key] = value;
    }

    return content;
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

  private truncate(text: string, max = 120): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
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
}
