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
      await this.notifier.notifyProgress(session, 'thinking...');
      let sawLiveEvent = false;
      const handleEvent = async (event: WorkerRunEvent) => {
        sawLiveEvent = true;
        session = await this.applyWorkerEvent(session, event);
      };
      const events = await this.workerClient.sendUserMessage({
        codex_thread_id,
        user_id: input.user_id,
        text: input.text,
      }, { onEvent: handleEvent });
      if (!sawLiveEvent) {
        session = await this.applyWorkerEvents(session, events);
      }
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
        await this.notifier.notifyProgress(current, 'thinking...');
        let sawLiveEvent = false;
        const handleEvent = async (event: WorkerRunEvent) => {
          sawLiveEvent = true;
          current = await this.applyWorkerEvent(current, event);
        };
        const steerEvents = await this.workerClient.sendSteerMessage({
          codex_thread_id: session.codex_thread_id,
          user_id: input.user_id,
          text: input.text,
        }, { onEvent: handleEvent });
        if (!sawLiveEvent) {
          current = await this.applyWorkerEvents(current, steerEvents);
        }
        return current;
      }

      if (session.state === 'waiting_approval' && session.pending_approval_id) {
        let sawRejectLiveEvent = false;
        const rejectHandleEvent = async (event: WorkerRunEvent) => {
          sawRejectLiveEvent = true;
          current = await this.applyWorkerEvent(current, event);
        };
        const rejectEvents = await this.workerClient.sendApprovalDecision({
          codex_thread_id: session.codex_thread_id,
          approval_id: session.pending_approval_id,
          decision: 'reject',
        }, { onEvent: rejectHandleEvent });
        if (!sawRejectLiveEvent) {
          current = await this.applyWorkerEvents(current, rejectEvents);
        }
        current = this.repository.updateSessionState({
          session_id: current.session_id,
          state: 'running',
          pending_approval_id: null,
        });
      }

      await this.notifier.notifyProgress(current, 'thinking...');
      let sawLiveEvent = false;
      const handleEvent = async (event: WorkerRunEvent) => {
        sawLiveEvent = true;
        current = await this.applyWorkerEvent(current, event);
      };
      const events = await this.workerClient.sendUserMessage({
        codex_thread_id: session.codex_thread_id,
        user_id: input.user_id,
        text: input.text,
      }, { onEvent: handleEvent });
      if (!sawLiveEvent) {
        current = await this.applyWorkerEvents(current, events);
      }
      return current;
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
      await this.notifier.notifyProgress(running, 'thinking...');
      let current = running;
      let sawLiveEvent = false;
      const handleEvent = async (event: WorkerRunEvent) => {
        sawLiveEvent = true;
        current = await this.applyWorkerEvent(current, event);
      };
      const events = await this.workerClient.sendApprovalDecision({
        codex_thread_id: session.codex_thread_id,
        approval_id: approvalId,
        decision: input.decision,
      }, { onEvent: handleEvent });
      if (!sawLiveEvent) {
        current = await this.applyWorkerEvents(current, events);
      }
      return current;
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
      current = await this.applyWorkerEvent(current, event);
    }

    return current;
  }

  private async applyWorkerEvent(session: Session, event: WorkerRunEvent): Promise<Session> {
    if (event.type === 'progress') {
      const current = this.repository.updateSessionState({
        session_id: session.session_id,
        state: 'running',
        pending_approval_id: null,
      });
      await this.notifier.notifyProgress(current, event.message);
      return current;
    }

    if (event.type === 'approval_required') {
      const current = this.repository.updateSessionState({
        session_id: session.session_id,
        state: 'waiting_approval',
        pending_approval_id: event.approval_id,
      });
      await this.notifier.notifyApproval(current, {
        approval_id: event.approval_id,
        prompt: event.prompt,
      });
      return current;
    }

    if (event.type === 'completed') {
      const current = this.repository.updateSessionState({
        session_id: session.session_id,
        state: 'idle',
        pending_approval_id: null,
      });
      await this.notifier.notifyCompleted(current, event.message);
      return current;
    }

    const current = this.repository.updateSessionState({
      session_id: session.session_id,
      state: 'failed',
      pending_approval_id: null,
    });
    await this.notifier.notifyFailed(current, event.error);
    return current;
  }
}
