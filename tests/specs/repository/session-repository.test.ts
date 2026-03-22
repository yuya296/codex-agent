import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SessionRepository } from '../../../src/repository/session-repository.js';
import { cleanupDir, createTempDir } from '../../support/helpers.js';

test('session repository keeps one Slack root thread mapped to only one session', () => {
  const tempDir = createTempDir();
  const dbPath = join(tempDir, 'app.sqlite');
  const repository = new SessionRepository(dbPath);

  repository.createSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '100.01',
    codex_thread_id: 'thread-1',
    state: 'idle',
  });

  assert.throws(() => {
    repository.createSession({
      channel_team_id: 'T1',
      channel_id: 'D1',
      channel_thread_id: '100.01',
      codex_thread_id: 'thread-2',
      state: 'idle',
    });
  });

  repository.close();
  cleanupDir(tempDir);
});
