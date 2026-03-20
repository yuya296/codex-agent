import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, type SlackPublisher } from '../src/gateway/gateway.js';
import { Orchestrator } from '../src/orchestrator/orchestrator.js';
import { SessionRepository } from '../src/repository/session-repository.js';
import { StdioJsonRpcWorkerClient } from '../src/worker/stdio-jsonrpc-worker-client.js';
import { cleanupDir, createTempDir } from './helpers.js';

class InMemorySlackPublisher implements SlackPublisher {
  public readonly posted: Array<{
    channel_id: string;
    root_thread_ts: string;
    text: string;
    blocks?: unknown[];
  }> = [];
  public readonly statuses: Array<{
    channel_id: string;
    root_thread_ts: string;
    status: string;
    loading_messages?: string[];
  }> = [];

  public async postThreadMessage(input: {
    channel_id: string;
    root_thread_ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<void> {
    this.posted.push(input);
  }

  public async setThreadStatus(input: {
    channel_id: string;
    root_thread_ts: string;
    status: string;
    loading_messages?: string[];
  }): Promise<void> {
    this.statuses.push(input);
  }
}

function fixturePath(): string {
  return fileURLToPath(new URL('./fixtures/mock-worker.mjs', import.meta.url));
}

test('integration: slack event -> gateway -> orchestrator -> stdio worker -> gateway notifications', async () => {
  const tempDir = createTempDir();
  const repository = new SessionRepository(join(tempDir, 'app.sqlite'));
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const publisher = new InMemorySlackPublisher();

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, worker, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });
  gateway = new Gateway(orchestrator, publisher);

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'hello',
    ts: '500.1',
    channel_type: 'im',
  });

  assert.equal(publisher.statuses.length, 2);
  assert.equal(publisher.statuses[0]?.status, 'thinking...');
  assert.equal(publisher.statuses[1]?.status, 'processing:hello');
  assert.equal(publisher.posted.length, 1);
  assert.equal(publisher.posted[0]?.text, 'done:hello');

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: '[APPROVAL] plan',
    ts: '500.2',
    thread_ts: '500.1',
    channel_type: 'im',
  });

  const approvalMsg = publisher.posted.at(-1);
  assert.ok(approvalMsg?.blocks);

  const actionValue = (
    (approvalMsg?.blocks?.[1] as any).elements[0].value as string
  );
  const actionPayload = JSON.parse(actionValue) as {
    team_id: string;
    channel_id: string;
    root_thread_ts: string;
    approval_id: string;
  };

  await gateway.handleApprovalAction({
    ...actionPayload,
    decision: 'approve',
  });

  assert.equal(publisher.statuses.at(-1)?.status, 'approval:approve');
  assert.equal(publisher.posted.at(-1)?.text, 'approval-complete:approve');

  await worker.close();
  repository.close();
  cleanupDir(tempDir);
});

test('integration: assistant_thread.thread_ts is used as slack root thread ts', async () => {
  const tempDir = createTempDir();
  const repository = new SessionRepository(join(tempDir, 'app.sqlite'));
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const publisher = new InMemorySlackPublisher();

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, worker, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });
  gateway = new Gateway(orchestrator, publisher);

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'hello',
    ts: '500.1',
    channel_type: 'im',
  });

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'follow-up',
    ts: '500.2',
    parent_user_id: 'B1',
    assistant_thread: { thread_ts: '500.1' },
    channel_type: 'im',
  });

  assert.equal(publisher.statuses.at(-1)?.root_thread_ts, '500.1');
  assert.equal(publisher.statuses.at(-1)?.status, 'processing:follow-up');
  assert.equal(publisher.statuses.at(-2)?.status, 'thinking...');
  assert.equal(publisher.posted.at(-1)?.text, 'done:follow-up');

  await worker.close();
  repository.close();
  cleanupDir(tempDir);
});

test('integration: initial assistant_thread.thread_ts starts a new session when none exists', async () => {
  const tempDir = createTempDir();
  const repository = new SessionRepository(join(tempDir, 'app.sqlite'));
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const publisher = new InMemorySlackPublisher();

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, worker, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });
  gateway = new Gateway(orchestrator, publisher);

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'hello',
    ts: '500.2',
    assistant_thread: { thread_ts: '500.1' },
    channel_type: 'im',
  });

  assert.equal(publisher.statuses.at(-1)?.root_thread_ts, '500.1');
  assert.equal(publisher.statuses.at(-1)?.status, 'processing:hello');
  assert.equal(publisher.statuses.at(-2)?.status, 'thinking...');
  assert.equal(publisher.posted.at(-1)?.text, 'done:hello');

  await worker.close();
  repository.close();
  cleanupDir(tempDir);
});

test('integration: dm message with inherited thread_ts but no parent_user_id starts a new session', async () => {
  const tempDir = createTempDir();
  const repository = new SessionRepository(join(tempDir, 'app.sqlite'));
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const publisher = new InMemorySlackPublisher();

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, worker, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });
  gateway = new Gateway(orchestrator, publisher);

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'first',
    ts: '500.1',
    channel_type: 'im',
  });

  await gateway.handleMessageEvent({
    team_id: 'T1',
    channel_id: 'D1',
    user_id: 'U1',
    text: 'second',
    ts: '500.3',
    thread_ts: '500.1',
    channel_type: 'im',
  });

  assert.equal(publisher.posted.at(-1)?.root_thread_ts, '500.3');
  assert.equal(publisher.posted.at(-1)?.text, 'done:second');

  await worker.close();
  repository.close();
  cleanupDir(tempDir);
});

test('integration: completed markdown is converted to mrkdwn before posting', async () => {
  const tempDir = createTempDir();
  const repository = new SessionRepository(join(tempDir, 'app.sqlite'));
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const publisher = new InMemorySlackPublisher();

  let gateway!: Gateway;
  const orchestrator = new Orchestrator(repository, worker, {
    notifyProgress: async (session, message) => gateway.notifyProgress(session, message),
    notifyApproval: async (session, approval) => gateway.notifyApproval(session, approval),
    notifyCompleted: async (session, message) => gateway.notifyCompleted(session, message),
    notifyFailed: async (session, message) => gateway.notifyFailed(session, message),
  });
  gateway = new Gateway(orchestrator, publisher);

  await gateway.notifyCompleted(
    {
      session_id: 'S1',
      slack_team_id: 'T1',
      slack_channel_id: 'D1',
      slack_root_thread_ts: '500.1',
      codex_thread_id: 'thread-1',
      state: 'idle',
      pending_approval_id: null,
      created_at: '2026-03-20T00:00:00.000Z',
      updated_at: '2026-03-20T00:00:00.000Z',
    },
    ['# Heading', '', '- **bold** item', '- [example](https://example.com)'].join('\n'),
  );

  assert.equal(publisher.posted.length, 1);
  assert.equal(publisher.posted[0]?.text.includes('# Heading'), false);
  assert.match(publisher.posted[0]?.text ?? '', /\*bold\*/);
  assert.match(publisher.posted[0]?.text ?? '', /<https:\/\/example\.com\|example>/);

  await worker.close();
  repository.close();
  cleanupDir(tempDir);
});
