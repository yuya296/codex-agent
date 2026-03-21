import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalRegistry } from '../src/worker/approval-registry.js';

test('ApprovalRegistry: consume returns and removes registered approval', () => {
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
