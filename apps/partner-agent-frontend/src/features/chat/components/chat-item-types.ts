/** Feature-local display and preview decision models. */
export type ChatItemTone = 'neutral' | 'thinking' | 'tool' | 'candidate' | 'approval' | 'runtime' | 'system';

export type ToolCallDisplay = {
  toolName: string;
  state?: 'queued' | 'running' | 'succeeded' | 'failed';
  inputPreview?: string;
  outputPreview?: string;
  previewOnly?: boolean;
};

export type CandidatePreviewAction = 'confirm' | 'modify' | 'reject' | 'later';

export interface CandidatePreviewDecision {
  candidateId: string;
  action: CandidatePreviewAction;
  applied: false;
  preview: { title: string; candidateType?: string; summary?: string; details?: string };
}

export type CandidateDecision = CandidatePreviewAction;

export type CandidateDisplay = {
  title: string;
  summary?: string;
  details?: string;
  candidateType?: string;
  previewOnly?: boolean;
  candidateId?: string;
  onDecision?: (decision: CandidatePreviewDecision) => void;
};

export type ApprovalDisplay = {
  title: string;
  summary?: string;
  details?: string;
  previewOnly?: boolean;
};

export type RuntimeStatusDisplay = {
  state?: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  summary?: string;
  details?: string;
};
