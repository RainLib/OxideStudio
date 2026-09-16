import {
  type AssistantProjectFileProposal,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { lineDiffCounts } from "@/lib/lineDiff";
import { type ProjectFileWriteResult } from "@/services/tauri/project-files.service";

export function upsertProjectFileChange(
  changes: AssistantTurn["fileChanges"],
  change: NonNullable<AssistantTurn["fileChanges"]>[number],
) {
  const current = changes ?? [];
  const withoutDuplicate = current.filter(
    (candidate) => candidate.callId !== change.callId,
  );
  return [...withoutDuplicate, change].slice(-128);
}

export function upsertProjectFileProposal(
  proposals: AssistantTurn["fileProposals"],
  proposal: NonNullable<AssistantTurn["fileProposals"]>[number],
) {
  const current = proposals ?? [];
  const withoutDuplicate = current.filter(
    (candidate) => candidate.callId !== proposal.callId,
  );
  return [...withoutDuplicate, proposal].slice(-128);
}

export function upsertAppliedFileReview(
  proposals: AssistantTurn["fileProposals"],
  review: NonNullable<AssistantTurn["fileProposals"]>[number],
) {
  const current = proposals ?? [];
  const previous = [...current]
    .reverse()
    .find(
      (candidate) =>
        candidate.status === "pending" &&
        candidate.relativePath === review.relativePath,
    );
  if (!previous || previous.proposedContent !== review.originalContent) {
    return upsertProjectFileProposal(current, review);
  }
  const counts = lineDiffCounts(
    previous.originalContent,
    review.proposedContent,
  );
  return current.map((candidate) =>
    candidate.callId === previous.callId
      ? {
          ...review,
          callId: previous.callId,
          sourceCallIds: Array.from(
            new Set([
              ...(previous.sourceCallIds ?? [previous.callId]),
              ...(review.sourceCallIds ?? [review.callId]),
            ]),
          ),
          operation: previous.operation,
          originalContent: previous.originalContent,
          keptChanges: previous.keptChanges,
          createdFileCanBeDeleted: previous.createdFileCanBeDeleted,
          additions: counts.additions,
          deletions: counts.deletions,
        }
      : candidate,
  );
}

export function updateReviewedFileAttribution(
  changes: AssistantTurn["fileChanges"],
  proposal: AssistantProjectFileProposal,
  result: ProjectFileWriteResult | null,
) {
  if (!result) return changes ?? [];
  const sourceCallIds = new Set(proposal.sourceCallIds ?? [proposal.callId]);
  const remaining = (changes ?? []).filter(
    (change) => !sourceCallIds.has(change.callId),
  );
  return upsertProjectFileChange(remaining, {
    callId: proposal.callId,
    relativePath: proposal.relativePath,
    operation: proposal.operation,
    revision: result.revision,
    previousRevision: result.previousRevision,
    occurredAt: Date.now(),
  });
}
