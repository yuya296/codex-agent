import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { StdioJsonRpcWorkerClient } from '../../../src/worker/stdio-jsonrpc-worker-client.js';
import type { WorkerRunEvent } from '../../../src/worker/types.js';

function fixturePath(): string {
  return fileURLToPath(new URL('../../fixtures/mock-worker.mjs', import.meta.url));
}

test('worker runtime resumes a known thread before sending a new user message', async () => {
  const first = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await first.createThread();
  await first.close();

  const second = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const events = await second.sendUserMessage({
    codex_thread_id,
    text: 'resume-check',
    user_id: 'U1',
  });

  assert.equal(events.at(0)?.type, 'progress');
  assert.equal(events.at(-1)?.type, 'completed');

  await second.close();
});

test('worker runtime fails immediately with method context when user-input requests are unsupported', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();

  const events = await worker.sendUserMessage({
    codex_thread_id,
    text: '[REQUEST_USER_INPUT]',
    user_id: 'U1',
  });

  assert.deepEqual(events, [
    {
      type: 'failed',
      error: 'worker requested unsupported client interaction: item/tool/requestUserInput (1 question(s))',
    },
  ]);

  await worker.close();
});

test('worker runtime surfaces approval-style elicitation requests and resumes after approval', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();

  const approvalEvents = await worker.sendUserMessage({
    codex_thread_id,
    text: '[ELICIT_APPROVAL]',
    user_id: 'U1',
  });

  assert.deepEqual(approvalEvents, [
    {
      type: 'approval_required',
      approval_id: 'elicitation-1',
      prompt: 'Allow Linear MCP Server to run tool "linear mcp server_save_project"?',
    },
  ]);

  const completedEvents = await worker.sendApprovalDecision({
    codex_thread_id,
    approval_id: 'elicitation-1',
    decision: 'approve',
  });

  assert.deepEqual(completedEvents, [
    {
      type: 'progress',
      message: 'approval:approve',
    },
    {
      type: 'completed',
      message: 'approval-complete:approve',
    },
  ]);

  await worker.close();
});

test('worker runtime still fails fast for elicitation requests that need structured input', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();

  const events = await worker.sendUserMessage({
    codex_thread_id,
    text: '[ELICIT_COMPLEX]',
    user_id: 'U1',
  });

  assert.deepEqual(events, [
    {
      type: 'failed',
      error: 'worker requested unsupported client interaction: mcpServer/elicitation/request (Project name is required.)',
    },
  ]);

  await worker.close();
});

test('worker runtime still surfaces approval requests when thread and turn ids are omitted', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();

  const events = await worker.sendUserMessage({
    codex_thread_id,
    text: '[APPROVAL_NO_IDS]',
    user_id: 'U1',
  });

  assert.deepEqual(events, [
    {
      type: 'approval_required',
      approval_id: 'approval-1',
      prompt: 'need approval\n```\n/bin/bash -lc playwright-cli --version\n```',
    },
  ]);

  await worker.close();
});

test('worker runtime includes the last matched turn event when a stream timeout is raised for diagnosis', async () => {
  const worker = new StdioJsonRpcWorkerClient(
    process.execPath,
    [fixturePath()],
    undefined,
    { streamEventTimeoutMs: 50 },
  );
  const { codex_thread_id } = await worker.createThread();

  await assert.rejects(
    () => worker.sendUserMessage({
      codex_thread_id,
      text: '[STALL]',
      user_id: 'U1',
    }),
    /timed out waiting for worker stream event \(50ms\); last turn event was notification:item\/completed \(agentMessage:processing:\[STALL\]\)/,
  );

  await worker.close();
});

test('worker runtime streams progress callbacks from agent message deltas before completion', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();
  const streamed: WorkerRunEvent[] = [];

  const events = await worker.sendUserMessage(
    {
      codex_thread_id,
      text: '[DELTA]',
      user_id: 'U1',
    },
    {
      onEvent: async (event) => {
        streamed.push(event);
      },
    },
  );

  assert.equal(streamed[0]?.type, 'progress');
  assert.equal(streamed[0]?.message, '調査しています。');
  assert.equal(streamed.at(-1)?.type, 'completed');
  assert.equal(events[0]?.type, 'progress');
  assert.equal(events.at(-1)?.type, 'completed');

  await worker.close();
});

test('worker runtime forwards failed turns to both streaming callbacks and return values', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();
  const streamed: WorkerRunEvent[] = [];

  const events = await worker.sendUserMessage(
    {
      codex_thread_id,
      text: '[FAIL]',
      user_id: 'U1',
    },
    {
      onEvent: async (event) => {
        streamed.push(event);
      },
    },
  );

  assert.deepEqual(streamed, [{ type: 'failed', error: 'mock-failure' }]);
  assert.deepEqual(events, [{ type: 'failed', error: 'mock-failure' }]);

  await worker.close();
});

test('worker runtime keeps a completed run successful when later error notifications are non-fatal', async () => {
  const worker = new StdioJsonRpcWorkerClient(process.execPath, [fixturePath()]);
  const { codex_thread_id } = await worker.createThread();

  const events = await worker.sendUserMessage({
    codex_thread_id,
    text: '[SOFT_ERROR]',
    user_id: 'U1',
  });

  assert.deepEqual(events, [
    {
      type: 'completed',
      message: 'done:[SOFT_ERROR]',
    },
  ]);

  await worker.close();
});
