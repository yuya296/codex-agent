import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResolvedApprovalBlocks,
  getActionMessageTs,
  readApprovalPrompt,
} from '../src/gateway/bolt.js';

test('buildResolvedApprovalBlocks: removes buttons and shows selection', () => {
  const blocks = buildResolvedApprovalBlocks('approve this?', 'approve');

  assert.equal(blocks.length, 2);
  assert.equal((blocks[0] as any).type, 'section');
  assert.equal((blocks[1] as any).type, 'context');
  assert.match((blocks[1] as any).elements[0].text, /Approve/);
});

test('getActionMessageTs: prefers container message ts', () => {
  assert.equal(
    getActionMessageTs({
      container: { message_ts: '100.1' },
      message: { ts: '100.2' },
    }),
    '100.1',
  );
});

test('readApprovalPrompt: falls back to payload prompt', () => {
  assert.equal(readApprovalPrompt({}, 'approve this?'), 'approve this?');
});
