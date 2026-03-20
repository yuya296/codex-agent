import type {
  ContinueSessionInput,
  ResolveApprovalInput,
  Session,
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

  public async startSessionFromSlack(input: StartSessionInput): Promise<Session> {
    const existing = this.repository.findBySlackThread(input);
    if (existing) {
      throw new Error('session already exists for slack root thread');
    }

    const { codex_thread_id } = await this.workerClient.createThread();
    let session = this.repository.createSession({
      ...input,
      codex_thread_id,
      state: 'running',
    });

    try {
      const events = await this.workerClient.sendUserMessage({
        codex_thread_id,
        user_id: input.user_id,
        text: input.text,
      });
      session = await this.applyWorkerEvents(session, events);
      return session;
    } catch (error) {
      session = this.repository.updateSessionState({
        session_id: session.session_id,
        state: 'failed',
        pending_approval_id: null,
      });
      await this.notifier.notifyFailed(session, `worker execution failed: ${String(error)}`);
      return session;
    }
  }

  public async continueSessionFromSlack(input: ContinueSessionInput): Promise<Session> {
    const session = this.repository.findBySlackThread(input);
    if (!session) {
      return this.startSessionFromSlack(input);
    }

    let current = this.repository.updateSessionState({
      session_id: session.session_id,
      state: 'running',
      pending_approval_id: null,
    });

    try {
      if (session.state === 'running') {
        const steerEvents = await this.workerClient.sendSteerMessage({
          codex_thread_id: session.codex_thread_id,
          user_id: input.user_id,
          text: input.text,
        });
        return this.applyWorkerEvents(current, steerEvents);
      }

      if (session.state === 'waiting_approval' && session.pending_approval_id) {
        const rejectEvents = await this.workerClient.sendApprovalDecision({
          codex_thread_id: session.codex_thread_id,
          approval_id: session.pending_approval_id,
          decision: 'reject',
        });
        current = await this.applyWorkerEvents(current, rejectEvents);
        current = this.repository.updateSessionState({
          session_id: current.session_id,
          state: 'running',
          pending_approval_id: null,
        });
      }

      const events = await this.workerClient.sendUserMessage({
        codex_thread_id: session.codex_thread_id,
        user_id: input.user_id,
        text: input.text,
      });
      return this.applyWorkerEvents(current, events);
    } catch (error) {
      const failed = this.repository.updateSessionState({
        session_id: session.session_id,
        state: 'failed',
        pending_approval_id: null,
      });
      await this.notifier.notifyFailed(failed, `worker execution failed: ${String(error)}`);
      return failed;
    }
  }

  public async resolveApproval(input: ResolveApprovalInput): Promise<Session> {
    const session = this.repository.findBySlackThread(input);
    if (!session) {
      throw new Error('session not found for approval');
    }

    const approvalId = session.pending_approval_id ?? input.approval_id;
    const running = this.repository.updateSessionState({
      session_id: session.session_id,
      state: 'running',
      pending_approval_id: null,
    });

    try {
      const events = await this.workerClient.sendApprovalDecision({
        codex_thread_id: session.codex_thread_id,
        approval_id: approvalId,
        decision: input.decision,
      });
      return this.applyWorkerEvents(running, events);
    } catch (error) {
      const failed = this.repository.updateSessionState({
        session_id: session.session_id,
        state: 'failed',
        pending_approval_id: null,
      });
      await this.notifier.notifyFailed(failed, `worker execution failed: ${String(error)}`);
      return failed;
    }
  }

  private async applyWorkerEvents(session: Session, events: WorkerRunEvent[]): Promise<Session> {
    let current = session;

    for (const event of events) {
      if (event.type === 'progress') {
        current = this.repository.updateSessionState({
          session_id: current.session_id,
          state: 'running',
          pending_approval_id: null,
        });
        await this.notifier.notifyProgress(current, event.message);
        continue;
      }

      if (event.type === 'approval_required') {
        current = this.repository.updateSessionState({
          session_id: current.session_id,
          state: 'waiting_approval',
          pending_approval_id: event.approval_id,
        });
        await this.notifier.notifyApproval(current, {
          approval_id: event.approval_id,
          prompt: event.prompt,
        });
        continue;
      }

      if (event.type === 'completed') {
        current = this.repository.updateSessionState({
          session_id: current.session_id,
          state: 'idle',
          pending_approval_id: null,
        });
        await this.notifier.notifyCompleted(current, event.message);
        continue;
      }

      if (event.type === 'failed') {
        current = this.repository.updateSessionState({
          session_id: current.session_id,
          state: 'failed',
          pending_approval_id: null,
        });
        await this.notifier.notifyFailed(current, event.error);
      }
    }

    return current;
  }
}
