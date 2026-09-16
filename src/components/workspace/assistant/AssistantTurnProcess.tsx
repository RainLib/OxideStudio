import {
  assistantTurnIsActive,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { ApprovalPrompt } from "./turn-process/approval";
import {
  LiveProcessTimeline,
  ProcessDisclosure,
} from "./turn-process/timeline";
import type { AssistantTurnProcessProps } from "./turn-process/types";

const VISIBLE_STATUS_WITHOUT_PROCESS = new Set<AssistantTurn["status"]>([
  "queued",
  "planning",
  "running",
  "awaiting_input",
  "awaiting_approval",
  "paused",
  "cancelling",
]);

export function AssistantTurnProcess({
  turn,
  contextFingerprint,
  onDecideApproval,
  onResume,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: AssistantTurnProcessProps) {
  const pendingApprovals = turn.approvals.filter(
    (approval) => !approval.decision,
  );
  const showActivity =
    turn.process.length > 0 || VISIBLE_STATUS_WITHOUT_PROCESS.has(turn.status);

  return (
    <div className="space-y-2" data-assistant-turn-process={turn.id}>
      {showActivity &&
        (assistantTurnIsActive(turn) ? (
          <LiveProcessTimeline
            turn={turn}
            onOpenProjectFile={onOpenProjectFile}
            onOpenProjectFileProposal={onOpenProjectFileProposal}
          />
        ) : (
          <ProcessDisclosure
            turn={turn}
            onResume={() => onResume(turn.id, contextFingerprint)}
            onOpenProjectFile={onOpenProjectFile}
            onOpenProjectFileProposal={onOpenProjectFileProposal}
          />
        ))}

      {pendingApprovals.map((approval) => (
        <ApprovalPrompt
          key={approval.approvalId}
          approval={approval}
          onDecision={(decision, confirmationText) =>
            onDecideApproval(
              turn.id,
              approval.approvalId,
              decision,
              contextFingerprint,
              confirmationText,
            )
          }
        />
      ))}
    </div>
  );
}
