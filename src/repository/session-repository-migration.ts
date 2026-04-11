import { existsSync } from 'node:fs';
import { SESSION_STATES, type SessionState } from '../domain/types.js';
import { SessionRepository } from './session-repository.js';

interface SqliteSessionRow {
  slack_team_id: string;
  slack_channel_id: string;
  slack_root_thread_ts: string;
  codex_thread_id: string;
  state: string;
  pending_approval_id: string | null;
}

export async function migrateSessionsFromSqlite(
  repository: SessionRepository,
  sqlitePath?: string,
): Promise<number> {
  if (!sqlitePath || !existsSync(sqlitePath)) {
    return 0;
  }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(sqlitePath, { open: true, readOnly: true });
  try {
    const rows = db.prepare(
      `
        SELECT
          slack_team_id,
          slack_channel_id,
          slack_root_thread_ts,
          codex_thread_id,
          state,
          pending_approval_id
        FROM sessions
      `,
    ).all() as unknown as SqliteSessionRow[];

    let migrated = 0;
    for (const row of rows) {
      const ref = {
        channel_team_id: row.slack_team_id,
        channel_id: row.slack_channel_id,
        channel_thread_id: row.slack_root_thread_ts,
      };
      const existing = await repository.findByChannelThread(ref);
      if (existing) {
        continue;
      }

      const state = toSessionState(row.state);
      await repository.createSession({
        ...ref,
        codex_thread_id: row.codex_thread_id,
        state,
      });

      if (row.pending_approval_id) {
        await repository.updateSessionState({
          ...ref,
          state,
          pending_approval_id: row.pending_approval_id,
        });
      }

      migrated += 1;
    }

    return migrated;
  } finally {
    db.close();
  }
}

function toSessionState(value: string): SessionState {
  if (SESSION_STATES.includes(value as SessionState)) {
    return value as SessionState;
  }

  return 'failed';
}
