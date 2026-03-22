import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalRegistry } from '../../../src/worker/approval-registry.js';

test('approval registry returns an approval once and removes it from the registry when it is consumed', () => {
  const registry = new ApprovalRegistry();

  registry.register('approval-1', {
    requestId: 1,
    method: 'execCommandApproval',
    threadId: 'thread-1',
    turnId: 'turn-1',
  });

  assert.deepEqual(registry.consume('approval-1'), {
    requestId: 1,
    method: 'execCommandApproval',
    threadId: 'thread-1',
    turnId: 'turn-1',
  });
  assert.equal(registry.consume('approval-1'), null);
});
