import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamEventQueue } from '../../../src/worker/stream-event-queue.js';

test('stream event queue delivers buffered events to later waiters when they match the pending predicate', async () => {
  const queue = new StreamEventQueue<{ type: string }>(50);

  queue.push({ type: 'ready' });

  await assert.doesNotReject(async () => {
    const event = await queue.waitFor((candidate) => candidate.type === 'ready');
    assert.deepEqual(event, { type: 'ready' });
  });
});

test('stream event queue times out unmatched waiters with the configured error message', async () => {
  const queue = new StreamEventQueue<{ type: string }>(10);

  await assert.rejects(
    () => queue.waitFor((candidate) => candidate.type === 'missing'),
    /timed out waiting for worker stream event \(10ms\)/,
  );
});
