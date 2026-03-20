import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { StdioJsonRpcWorkerClient } from '../src/worker/stdio-jsonrpc-worker-client.js';

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
