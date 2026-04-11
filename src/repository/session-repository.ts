import type { StateAdapter } from 'chat';
import { type ChannelThreadRef, type Session, type SessionState } from '../domain/types.js';

interface CreateSessionInput extends ChannelThreadRef {
  codex_thread_id: string;
  state: SessionState;
}

interface UpdateSessionStateInput extends ChannelThreadRef {
  state: SessionState;
  pending_approval_id?: string | null;
}

type SessionStateStore = Pick<StateAdapter, 'get' | 'set' | 'setIfNotExists'>;

export class SessionRepository {
  private readonly memory = new Map<string, Session>();

  public constructor(private readonly store: SessionStateStore | ':memory:' = ':memory:') {}

  public close(): void {
    this.memory.clear();
  }

  public async createSession(input: CreateSessionInput): Promise<Session> {
    const session: Session = {
      slack_team_id: input.channel_team_id,
      slack_channel_id: input.channel_id,
      slack_root_thread_ts: input.channel_thread_id,
      codex_thread_id: input.codex_thread_id,
      state: input.state,
      pending_approval_id: null,
    };
    const key = toSessionKey(input);

    if (this.store === ':memory:') {
      if (this.memory.has(key)) {
        throw new Error('session already exists for channel thread');
      }
      this.memory.set(key, session);
      return session;
    }

    const created = await this.store.setIfNotExists(key, session);
    if (!created) {
      throw new Error('session already exists for channel thread');
    }

    return session;
  }

  public async findByChannelThread(ref: ChannelThreadRef): Promise<Session | null> {
    if (this.store === ':memory:') {
      return this.memory.get(toSessionKey(ref)) ?? null;
    }

    return this.store.get<Session>(toSessionKey(ref));
  }

  public async updateSessionState(input: UpdateSessionStateInput): Promise<Session> {
    const current = await this.findByChannelThread(input);
    if (!current) {
      throw new Error(
        `session not found for channel thread: ${input.channel_team_id}/${input.channel_id}/${input.channel_thread_id}`,
      );
    }

    const updated: Session = {
      ...current,
      state: input.state,
      pending_approval_id: input.pending_approval_id ?? null,
    };
    const key = toSessionKey(input);

    if (this.store === ':memory:') {
      this.memory.set(key, updated);
      return updated;
    }

    await this.store.set(key, updated);
    return updated;
  }
}

function toSessionKey(ref: ChannelThreadRef): string {
  return `session:${ref.channel_team_id}:${ref.channel_id}:${ref.channel_thread_id}`;
}
