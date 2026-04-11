import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRepository } from '../../../src/repository/session-repository.js';

test('session repository keeps one Slack root thread mapped to only one session', async () => {
  const repository = new SessionRepository(':memory:');

  await repository.createSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '100.01',
    codex_thread_id: 'thread-1',
    state: 'idle',
  });

  await assert.rejects(() => repository.createSession({
      channel_team_id: 'T1',
      channel_id: 'D1',
      channel_thread_id: '100.01',
      codex_thread_id: 'thread-2',
      state: 'idle',
    }), /session already exists for channel thread/);

  repository.close();
});
