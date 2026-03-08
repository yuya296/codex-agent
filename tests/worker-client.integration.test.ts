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
