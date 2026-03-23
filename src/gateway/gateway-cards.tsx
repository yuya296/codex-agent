/** @jsxImportSource chat */

import { Actions, Button, Card, CardText, toCardElement, type CardElement } from 'chat';

export function buildApprovalCard(prompt: string, actionValue: string): CardElement {
  return toCardElement(
    <Card title="Approval required">
      <CardText>{prompt}</CardText>
      <Actions>
        <Button id="approve" value={actionValue} style="primary">Approve</Button>
        <Button id="reject" value={actionValue} style="danger">Reject</Button>
      </Actions>
    </Card>,
  )!;
}

export function buildResolvedApprovalCard(
  prompt: string,
  decision: 'approve' | 'reject',
): CardElement {
  return toCardElement(
    <Card title="Approval resolved">
      <CardText>{prompt}</CardText>
      <CardText>{`選択: ${decision === 'approve' ? 'Approve' : 'Reject'}`}</CardText>
    </Card>,
  )!;
}
