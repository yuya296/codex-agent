import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamEventQueue } from '../src/worker/stream-event-queue.js';

test('StreamEventQueue: buffered event is returned to a later waiter', async () => {
  const queue = new StreamEventQueue<{ type: string }>(50);

  queue.push({ type: 'ready' });

  await assert.doesNotReject(async () => {
    const event = await queue.waitFor((candidate) => candidate.type === 'ready');
    assert.deepEqual(event, { type: 'ready' });
  });
});

test('StreamEventQueue: timeout rejects waiter', async () => {
  const queue = new StreamEventQueue<{ type: string }>(10);

  await assert.rejects(
    () => queue.waitFor((candidate) => candidate.type === 'missing'),
    /timed out waiting for worker stream event \(10ms\)/,
  );
});
