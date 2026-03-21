import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SESSION_STATES, type ChannelThreadRef, type Session, type SessionState } from '../domain/types.js';

interface CreateSessionInput extends ChannelThreadRef {
  codex_thread_id: string;
  state: SessionState;
}

interface UpdateSessionStateInput {
  session_id: string;
  state: SessionState;
  pending_approval_id?: string | null;
}

const sessionStateCheck = SESSION_STATES.map((s) => `'${s}'`).join(', ');

export class SessionRepository {
  private readonly db: DatabaseSync;

  public constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        slack_team_id TEXT NOT NULL,
        slack_channel_id TEXT NOT NULL,
        slack_root_thread_ts TEXT NOT NULL,
        codex_thread_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (${sessionStateCheck})),
        pending_approval_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (slack_team_id, slack_channel_id, slack_root_thread_ts)
      );
    `);
  }

  public close(): void {
    this.db.close();
  }

  public createSession(input: CreateSessionInput): Session {
    const now = new Date().toISOString();
    const session: Session = {
      session_id: randomUUID(),
      slack_team_id: input.channel_team_id,
      slack_channel_id: input.channel_id,
      slack_root_thread_ts: input.channel_thread_id,
      codex_thread_id: input.codex_thread_id,
      state: input.state,
      pending_approval_id: null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `
          INSERT INTO sessions (
            session_id,
            slack_team_id,
            slack_channel_id,
            slack_root_thread_ts,
            codex_thread_id,
            state,
            pending_approval_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        session.session_id,
        session.slack_team_id,
        session.slack_channel_id,
        session.slack_root_thread_ts,
        session.codex_thread_id,
        session.state,
        session.pending_approval_id,
        session.created_at,
        session.updated_at,
      );

    return session;
  }

  public findByChannelThread(ref: ChannelThreadRef): Session | null {
    const row = this.db
      .prepare(
        `
          SELECT
            session_id,
            slack_team_id,
            slack_channel_id,
            slack_root_thread_ts,
            codex_thread_id,
            state,
            pending_approval_id,
            created_at,
            updated_at
          FROM sessions
          WHERE slack_team_id = ?
            AND slack_channel_id = ?
            AND slack_root_thread_ts = ?
          LIMIT 1
        `,
      )
      .get(ref.channel_team_id, ref.channel_id, ref.channel_thread_id) as Session | undefined;

    return row ?? null;
  }

  public findById(sessionId: string): Session | null {
    const row = this.db
      .prepare(
        `
          SELECT
            session_id,
            slack_team_id,
            slack_channel_id,
            slack_root_thread_ts,
            codex_thread_id,
            state,
            pending_approval_id,
            created_at,
            updated_at
          FROM sessions
          WHERE session_id = ?
          LIMIT 1
        `,
      )
      .get(sessionId) as Session | undefined;

    return row ?? null;
  }

  public updateSessionState(input: UpdateSessionStateInput): Session {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
          UPDATE sessions
          SET state = ?,
              pending_approval_id = ?,
              updated_at = ?
          WHERE session_id = ?
        `,
      )
      .run(input.state, input.pending_approval_id ?? null, now, input.session_id);

    const updated = this.findById(input.session_id);
    if (!updated) {
      throw new Error(`session not found after update: ${input.session_id}`);
    }
    return updated;
  }
}
