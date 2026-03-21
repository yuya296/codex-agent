export const SESSION_STATES = [
  'idle',
  'running',
  'waiting_approval',
  'failed',
  'cancelled',
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export interface ChannelThreadRef {
  channel_team_id: string;
  channel_id: string;
  channel_thread_id: string;
}

export interface SlackThreadRef {
  slack_team_id: string;
  slack_channel_id: string;
  slack_root_thread_ts: string;
}

export interface CodexThreadRef {
  codex_thread_id: string;
}

export interface Session extends SlackThreadRef, CodexThreadRef {
  session_id: string;
  state: SessionState;
  pending_approval_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ApprovalDecision = 'approve' | 'reject';

export interface ApprovalRequest {
  approval_id: string;
  prompt: string;
}

export interface StartSessionInput extends ChannelThreadRef {
  user_id: string;
  text: string;
}

export interface ContinueSessionInput extends ChannelThreadRef {
  user_id: string;
  text: string;
}

export interface ResolveApprovalInput extends ChannelThreadRef {
  approval_id: string;
  decision: ApprovalDecision;
}
