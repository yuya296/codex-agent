import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { SessionRepository } from '../src/repository/session-repository.js';
import { cleanupDir, createTempDir, MockNotifier, MockWorkerClient } from './helpers.js';

function createDeps() {
  const tempDir = createTempDir();
  const repository = new SessionRepository(join(tempDir, 'app.sqlite'));
  const worker = new MockWorkerClient();
  const notifier = new MockNotifier();
  const orchestrator = new Orchestrator(repository, worker, notifier);
  return { tempDir, repository, worker, notifier, orchestrator };
}

test('running state: additional message should be handled as steer', async () => {
  const { tempDir, repository, worker, notifier, orchestrator } = createDeps();

  worker.sendUserMessageImpl = async ({ text }) => [{ type: 'progress', message: `working:${text}` }];
  worker.sendSteerMessageImpl = async ({ text }) => [{ type: 'progress', message: `steer:${text}` }];

  const started = await orchestrator.startSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.1',
    user_id: 'U1',
    text: 'first',
  });
  assert.equal(started.state, 'running');

  const continued = await orchestrator.continueSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.1',
    user_id: 'U1',
    text: 'second',
  });

  assert.equal(continued.state, 'running');
  assert.equal(worker.sendSteerMessageCalls.length, 1);
  assert.equal(worker.sendSteerMessageCalls[0]?.text, 'second');
  assert.deepEqual(notifier.progressMessages, ['thinking...', 'working:first', 'thinking...', 'steer:second']);

  repository.close();
  cleanupDir(tempDir);
});

test('waiting_approval state: additional message should reject current approval and send new user message', async () => {
  const { tempDir, repository, worker, notifier, orchestrator } = createDeps();

  worker.sendUserMessageImpl = async ({ text }) => {
    if (text === 'first') {
      return [
        {
          type: 'approval_required',
          approval_id: 'approval-1',
          prompt: 'approve?',
        },
      ];
    }
    return [{ type: 'completed', message: `done:${text}` }];
  };

  await orchestrator.startSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.2',
    user_id: 'U1',
    text: 'first',
  });

  const sessionBefore = repository.findByChannelThread({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.2',
  });
  assert.equal(sessionBefore?.state, 'waiting_approval');
  assert.equal(sessionBefore?.pending_approval_id, 'approval-1');

  const continued = await orchestrator.continueSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.2',
    user_id: 'U1',
    text: 'new-plan',
  });

  assert.equal(continued.state, 'idle');
  assert.deepEqual(worker.callLog, [
    'createThread',
    'sendUserMessage',
    'sendApprovalDecision',
    'sendUserMessage',
  ]);
  assert.equal(worker.sendApprovalDecisionCalls[0]?.decision, 'reject');
  assert.equal(worker.sendUserMessageCalls.at(-1)?.text, 'new-plan');
  assert.deepEqual(notifier.progressMessages, ['thinking...', 'thinking...']);

  repository.close();
  cleanupDir(tempDir);
});

test('approval button: decision should be forwarded to worker', async () => {
  const { tempDir, repository, worker, notifier, orchestrator } = createDeps();

  worker.sendUserMessageImpl = async () => [
    {
      type: 'approval_required',
      approval_id: 'approval-2',
      prompt: 'approve now?',
    },
  ];

  await orchestrator.startSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.3',
    user_id: 'U1',
    text: 'ask',
  });

  const resolved = await orchestrator.resolveApproval({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.3',
    approval_id: 'approval-2',
    decision: 'approve',
  });

  assert.equal(worker.sendApprovalDecisionCalls.length, 1);
  assert.equal(worker.sendApprovalDecisionCalls[0]?.approval_id, 'approval-2');
  assert.equal(worker.sendApprovalDecisionCalls[0]?.decision, 'approve');
  assert.equal(resolved.state, 'idle');
  assert.deepEqual(notifier.progressMessages, ['thinking...', 'thinking...']);

  repository.close();
  cleanupDir(tempDir);
});

test('failed session should remain resumable via same slack thread', async () => {
  const { tempDir, repository, worker, orchestrator, notifier } = createDeps();

  let first = true;
  worker.sendUserMessageImpl = async ({ text }) => {
    if (first) {
      first = false;
      return [{ type: 'failed', error: 'boom' }];
    }
    return [{ type: 'completed', message: `recovered:${text}` }];
  };

  const started = await orchestrator.startSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.4',
    user_id: 'U1',
    text: 'first',
  });
  assert.equal(started.state, 'failed');
  assert.equal(notifier.failedMessages.length, 1);

  const resumed = await orchestrator.continueSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.4',
    user_id: 'U1',
    text: 'retry',
  });

  assert.equal(resumed.state, 'idle');
  assert.equal(worker.sendUserMessageCalls.at(-1)?.text, 'retry');
  assert.deepEqual(notifier.progressMessages, ['thinking...', 'thinking...']);

  repository.close();
  cleanupDir(tempDir);
});

test('missing session on thread reply should start a new session', async () => {
  const { tempDir, repository, worker, notifier, orchestrator } = createDeps();

  worker.sendUserMessageImpl = async ({ text }) => [{ type: 'completed', message: `done:${text}` }];

  const started = await orchestrator.continueSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.5',
    user_id: 'U1',
    text: 'first',
  });

  assert.equal(started.state, 'idle');
  assert.deepEqual(worker.callLog, ['createThread', 'sendUserMessage']);
  assert.deepEqual(notifier.progressMessages, ['thinking...']);

  const saved = repository.findByChannelThread({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.5',
  });
  assert.equal(saved?.session_id, started.session_id);

  repository.close();
  cleanupDir(tempDir);
});

test('worker callback: streaming progress should be reflected before returned events are empty', async () => {
  const { tempDir, repository, worker, notifier, orchestrator } = createDeps();

  worker.sendUserMessageImpl = async ({ text }, options) => {
    await options?.onEvent?.({ type: 'progress', message: `stream:${text}` });
    await options?.onEvent?.({ type: 'completed', message: `done:${text}` });
    return [];
  };

  const started = await orchestrator.startSession({
    channel_team_id: 'T1',
    channel_id: 'D1',
    channel_thread_id: '111.6',
    user_id: 'U1',
    text: 'live',
  });

  assert.equal(started.state, 'idle');
  assert.deepEqual(notifier.progressMessages, ['thinking...', 'stream:live']);
  assert.deepEqual(notifier.completedMessages, ['done:live']);

  repository.close();
  cleanupDir(tempDir);
});
