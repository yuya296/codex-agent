export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalRequest {
  approval_id: string;
  prompt: string;
}

export interface ThreadSessionState {
  codexThreadId: string;
  pendingApprovalId: string | null;
}
