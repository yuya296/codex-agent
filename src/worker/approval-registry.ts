type JsonRpcId = number | string;

export interface PendingApproval {
  requestId: JsonRpcId;
  method: string;
  threadId: string;
  turnId: string;
}

export class ApprovalRegistry {
  private readonly approvals = new Map<string, PendingApproval>();

  public register(approvalId: string, approval: PendingApproval): string {
    this.approvals.set(approvalId, approval);
    return approvalId;
  }

  public consume(approvalId: string): PendingApproval | null {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      return null;
    }

    this.approvals.delete(approvalId);
    return approval;
  }
}
