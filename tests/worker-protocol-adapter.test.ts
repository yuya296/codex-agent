import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerProtocolAdapter } from '../src/worker/worker-protocol-adapter.js';

function createAdapter() {
  return new WorkerProtocolAdapter((turnId) => (turnId === 'turn-1' ? 'thread-1' : undefined));
}

test('WorkerProtocolAdapter: resolves threadId from turn map when only turnId is present', () => {
  const adapter = createAdapter();

  const event = adapter.toStreamEvent('notification', 'item/completed', {
    turnId: 'turn-1',
    item: { type: 'agentMessage', text: 'done' },
  });

  assert.equal(event.threadId, 'thread-1');
  assert.equal(event.turnId, 'turn-1');
});

test('WorkerProtocolAdapter: reads completed final answer payload', () => {
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
