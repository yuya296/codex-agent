import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResolvedApprovalBlocks,
  getActionMessageTs,
  readApprovalPrompt,
} from '../../../src/gateway/bolt.js';

test('Slack approval UI replaces decision buttons with the chosen result after an approval is resolved', () => {
  const blocks = buildResolvedApprovalBlocks('approve this?', 'approve');

  assert.equal(blocks.length, 2);
  assert.equal((blocks[0] as any).type, 'section');
  assert.equal((blocks[1] as any).type, 'context');
  assert.match((blocks[1] as any).elements[0].text, /Approve/);
});

test('Slack approval UI targets the container message timestamp first when updating an action response', () => {
  assert.equal(
    getActionMessageTs({
      container: { message_ts: '100.1' },
      message: { ts: '100.2' },
    }),
    '100.1',
  );
});

test('Slack approval UI falls back to the payload text when approval blocks are unavailable', () => {
  assert.equal(readApprovalPrompt({}, 'approve this?'), 'approve this?');
});
