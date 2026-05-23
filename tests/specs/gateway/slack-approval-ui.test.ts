import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovalCard,
  buildResolvedApprovalCard,
} from '../../../src/gateway/gateway-cards.js';
import { toSlackApprovalPrompt } from '../../../src/gateway/gateway.js';

test('Slack approval UI renders approve and reject actions with the encoded payload', () => {
  const card = buildApprovalCard('approve this?', '{"approval_id":"approval-1"}') as any;

  const actions = card.children[1].children;
  assert.equal(card.title, 'Approval required');
  assert.equal(actions[0].id, 'approve');
  assert.equal(actions[1].id, 'reject');
  assert.equal(actions[0].value, '{"approval_id":"approval-1"}');
});

test('Slack approval UI replaces actions with a resolved summary after an approval is resolved', () => {
  const card = buildResolvedApprovalCard('approve this?', 'approve') as any;

  assert.equal(card.title, 'Approval resolved');
  assert.equal(card.children[1].content, '選択: Approve');
});

test('Slack approval UI truncates oversized prompts so the rendered card stays within Slack limits', () => {
  const truncated = toSlackApprovalPrompt('x'.repeat(4000));

  assert.equal(truncated.length <= 3000, true);
  assert.equal(truncated.endsWith('…'), true);
});
