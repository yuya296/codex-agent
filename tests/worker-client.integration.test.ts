import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { StdioJsonRpcWorkerClient } from '../src/worker/stdio-jsonrpc-worker-client.js';
import type { WorkerRunEvent } from '../src/worker/types.js';

function fixturePath(): string {
  return fileURLToPath(new URL('./fixtures/mock-worker.mjs', import.meta.url));
}

test('worker client: resumes thread before turn/start when local cache is empty', async () => {
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

test('worker client: unsupported user-input request fails immediately with method context', async () => {
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

test('worker client: approval request without explicit thread/turn ids still becomes approval_required', async () => {
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

test('worker client: timeout includes last turn event details', async () => {
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

test('worker client: agentMessage delta emits streaming progress callbacks', async () => {
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

test('worker client: failed turn is emitted to streaming callbacks', async () => {
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

test('worker client: non-fatal error notification does not fail a completed turn', async () => {
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
