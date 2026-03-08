import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SessionRepository } from '../src/repository/session-repository.js';
import { cleanupDir, createTempDir } from './helpers.js';

test('sqlite persistence: session mapping should be recoverable after restart', () => {
  const tempDir = createTempDir();
  const dbPath = join(tempDir, 'app.sqlite');

  const first = new SessionRepository(dbPath);
  const created = first.createSession({
    slack_team_id: 'T1',
    slack_channel_id: 'D1',
    slack_root_thread_ts: '900.1',
    codex_thread_id: 'thread-900',
    state: 'idle',
  });
  first.close();

  const second = new SessionRepository(dbPath);
  const recovered = second.findBySlackThread({
    slack_team_id: 'T1',
    slack_channel_id: 'D1',
    slack_root_thread_ts: '900.1',
  });

  assert.ok(recovered);
  assert.equal(recovered?.session_id, created.session_id);
  assert.equal(recovered?.codex_thread_id, 'thread-900');

  second.close();
  cleanupDir(tempDir);
});
