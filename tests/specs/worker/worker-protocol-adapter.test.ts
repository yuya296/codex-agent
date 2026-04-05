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

test('worker protocol adapter converts approval-style elicitation decisions into MCP elicitation results', () => {
  const adapter = createAdapter();

  const result = adapter.buildApprovalResponse(
    'mcpServer/elicitation/request',
    'approve',
    {
      requestedSchema: {
        type: 'object',
        properties: {
          allow: {
            type: 'boolean',
          },
        },
        required: ['allow'],
      },
    },
  );

  assert.deepEqual(result, {
    action: 'accept',
    content: {
      allow: true,
    },
  });
});

test('worker protocol adapter does not treat url-mode elicitation as approval-style', () => {
  const adapter = createAdapter();

  const supported = adapter.supportsApprovalStyleElicitation({
    kind: 'request',
    method: 'mcpServer/elicitation/request',
    params: {
      mode: 'url',
      message: 'Open browser',
      url: 'https://example.com/oauth',
    },
  });

  assert.equal(supported, false);
});

test('worker protocol adapter does not treat multi-boolean elicitation as approval-style', () => {
  const adapter = createAdapter();

  const supported = adapter.supportsApprovalStyleElicitation({
    kind: 'request',
    method: 'mcpServer/elicitation/request',
    params: {
      requestedSchema: {
        type: 'object',
        properties: {
          allow: { type: 'boolean' },
          remember: { type: 'boolean' },
        },
        required: ['allow'],
      },
    },
  });

  assert.equal(supported, false);
});
