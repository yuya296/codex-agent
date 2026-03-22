import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerProtocolAdapter } from '../../../src/worker/worker-protocol-adapter.js';

function createAdapter() {
  return new WorkerProtocolAdapter((turnId) => (turnId === 'turn-1' ? 'thread-1' : undefined));
}

test('worker protocol adapter recovers a thread id from the active turn map when an event only carries a turn id', () => {
  const adapter = createAdapter();

  const event = adapter.toStreamEvent('notification', 'item/completed', {
    turnId: 'turn-1',
    item: { type: 'agentMessage', text: 'done' },
  });

  assert.equal(event.threadId, 'thread-1');
  assert.equal(event.turnId, 'turn-1');
});

test('worker protocol adapter extracts completed final answers from item/completed events', () => {
  const adapter = createAdapter();

  const message = adapter.readCompletedAgentMessage({
    kind: 'notification',
    method: 'item/completed',
    params: {
      item: {
        type: 'agentMessage',
        text: 'final',
        phase: 'final_answer',
      },
    },
  });

  assert.deepEqual(message, { text: 'final', phase: 'final_answer' });
});
