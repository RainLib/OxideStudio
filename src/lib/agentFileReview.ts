import type { AssistantProjectFileProposal } from "@/ai/assistant/turns";
import type { LineDiffHunk } from "@/lib/lineDiff";

export type AgentFileDiffPreview = AssistantProjectFileProposal & {
  turnId: string;
  projectId: string;
  expectedRoot?: string | null;
};

export const APP_EVENT_AGENT_FILE_REVIEW =
  "oxide:agent-file-review-decision";

export type AgentFileReviewDecisionDetail = {
  turnId: string;
  callId: string;
  action: "keep-file" | "undo-file" | "keep-hunk" | "undo-hunk";
  hunk?: LineDiffHunk;
};

export function requestAgentFileReviewDecision(
  detail: AgentFileReviewDecisionDetail,
) {
  window.dispatchEvent(
    new CustomEvent<AgentFileReviewDecisionDetail>(
      APP_EVENT_AGENT_FILE_REVIEW,
      { detail },
    ),
  );
}
