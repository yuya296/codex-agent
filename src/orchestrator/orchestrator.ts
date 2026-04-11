import type {
  ContinueSessionInput,
  ResolveApprovalInput,
  Session,
  SessionState,
  StartSessionInput,
} from '../domain/types.js';
import { SessionRepository } from '../repository/session-repository.js';
import type { WorkerClient, WorkerRunEvent } from '../worker/types.js';

export interface GatewayNotifier {
  notifyProgress(session: Session, message: string): Promise<void>;
  notifyApproval(session: Session, approval: { approval_id: string; prompt: string }): Promise<void>;
  notifyCompleted(session: Session, message: string): Promise<void>;
  notifyFailed(session: Session, message: string): Promise<void>;
}

export class Orchestrator {
  public constructor(
    private readonly repository: SessionRepository,
    private readonly workerClient: WorkerClient,
    private readonly notifier: GatewayNotifier,
  ) {}

  public async startSession(input: StartSessionInput): Promise<Session> {
    const existing = await this.repository.findByChannelThread(input);
    if (existing) {
      throw new Error('session already exists for channel thread');
    }

    const { codex_thread_id } = await this.workerClient.createThread();
    const session = await this.repository.createSession({
      ...input,
      codex_thread_id,
      state: 'running',
    });

    return this.runWorkerFlow(session, async (onEvent) => this.workerClient.sendUserMessage({
      codex_thread_id,
      user_id: input.user_id,
      text: input.text,
    }, { onEvent }));
  }

  public async continueSession(input: ContinueSessionInput): Promise<Session> {
    const session = await this.repository.findByChannelThread(input);
    if (!session) {
      return this.startSession(input);
    }

    let current = await this.updateSessionState(session, 'running');

    try {
      if (session.state === 'running') {
        return this.runWorkerFlow(current, async (onEvent) => this.workerClient.sendSteerMessage({
          codex_thread_id: session.codex_thread_id,
          user_id: input.user_id,
          text: input.text,
        }, { onEvent }));
      }

      if (session.state === 'waiting_approval' && session.pending_approval_id) {
        current = await this.runWorkerFlow(
          current,
          async (onEvent) => this.workerClient.sendApprovalDecision({
            codex_thread_id: session.codex_thread_id,
            approval_id: session.pending_approval_id!,
            decision: 'reject',
          }, { onEvent }),
          { notifyProgress: false },
        );
        current = await this.updateSessionState(current, 'running');
      }

      return this.runWorkerFlow(current, async (onEvent) => this.workerClient.sendUserMessage({
        codex_thread_id: session.codex_thread_id,
        user_id: input.user_id,
        text: input.text,
      }, { onEvent }));
    } catch (error) {
      return this.failSession(session, error);
    }
  }

  public async resolveApproval(input: ResolveApprovalInput): Promise<Session> {
    const session = await this.repository.findByChannelThread(input);
    if (!session) {
      throw new Error('session not found for approval');
    }

    const approvalId = session.pending_approval_id ?? input.approval_id;
    const running = await this.updateSessionState(session, 'running');

    return this.runWorkerFlow(running, async (onEvent) => this.workerClient.sendApprovalDecision({
      codex_thread_id: session.codex_thread_id,
      approval_id: approvalId,
      decision: input.decision,
    }, { onEvent }));
  }

  private async runWorkerFlow(
    session: Session,
    action: (onEvent: (event: WorkerRunEvent) => Promise<void>) => Promise<WorkerRunEvent[]>,
    options?: { notifyProgress?: boolean },
  ): Promise<Session> {
    try {
      let current = session;
      if (options?.notifyProgress !== false) {
        await this.notifier.notifyProgress(current, 'thinking...');
      }

      let sawLiveEvent = false;
      const events = await action(async (event) => {
        sawLiveEvent = true;
        current = await this.applyWorkerEvent(current, event);
      });

      if (!sawLiveEvent) {
        current = await this.applyWorkerEvents(current, events);
      }

      return current;
    } catch (error) {
      return this.failSession(session, error);
    }
  }

  private async failSession(session: Session, error: unknown): Promise<Session> {
    const failed = await this.updateSessionState(session, 'failed');
    await this.notifier.notifyFailed(failed, `worker execution failed: ${String(error)}`);
    return failed;
  }

  private async updateSessionState(
    session: Session,
    state: SessionState,
    pendingApprovalId?: string | null,
  ): Promise<Session> {
    return this.repository.updateSessionState({
      channel_team_id: session.slack_team_id,
      channel_id: session.slack_channel_id,
      channel_thread_id: session.slack_root_thread_ts,
      state,
      pending_approval_id: pendingApprovalId,
    });
  }

  private async applyWorkerEvents(session: Session, events: WorkerRunEvent[]): Promise<Session> {
    let current = session;

    for (const event of events) {
      current = await this.applyWorkerEvent(current, event);
    }

    return current;
  }

  private async applyWorkerEvent(session: Session, event: WorkerRunEvent): Promise<Session> {
    if (event.type === 'progress') {
      const current = await this.updateSessionState(session, 'running');
      await this.notifier.notifyProgress(current, event.message);
      return current;
    }

    if (event.type === 'approval_required') {
      const current = await this.updateSessionState(session, 'waiting_approval', event.approval_id);
      await this.notifier.notifyApproval(current, {
        approval_id: event.approval_id,
        prompt: event.prompt,
      });
      return current;
    }

    if (event.type === 'completed') {
      const current = await this.updateSessionState(session, 'idle');
      await this.notifier.notifyCompleted(current, event.message);
      return current;
    }

    const current = await this.updateSessionState(session, 'failed');
    await this.notifier.notifyFailed(current, event.error);
    return current;
  }
}
