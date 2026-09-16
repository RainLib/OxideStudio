import { type AssistantTurn } from "@/ai/assistant/turns";

export function restoreProjectFileChanges(
  value: unknown,
): NonNullable<AssistantTurn["fileChanges"]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (
        candidate,
      ): candidate is NonNullable<AssistantTurn["fileChanges"]>[number] => {
        if (!candidate || typeof candidate !== "object") return false;
        const change = candidate as Record<string, unknown>;
        return (
          typeof change.callId === "string" &&
          safeRestoredProjectPath(change.relativePath) &&
          (change.operation === "created" || change.operation === "updated") &&
          typeof change.revision === "string" &&
          /^[a-f0-9]{64}$/u.test(change.revision) &&
          (change.previousRevision === undefined ||
            change.previousRevision === null ||
            (typeof change.previousRevision === "string" &&
              /^[a-f0-9]{64}$/u.test(change.previousRevision))) &&
          (change.introducedLines === undefined ||
            (Array.isArray(change.introducedLines) &&
              change.introducedLines.length <= 2_048 &&
              change.introducedLines.every(
                (line, index, lines) =>
                  Number.isInteger(line) &&
                  Number(line) > 0 &&
                  (index === 0 || Number(line) > Number(lines[index - 1])),
              ))) &&
          (change.lineEvidenceTruncated === undefined ||
            typeof change.lineEvidenceTruncated === "boolean") &&
          (change.additions === undefined ||
            (typeof change.additions === "number" &&
              Number.isInteger(change.additions) &&
              change.additions >= 0)) &&
          (change.deletions === undefined ||
            (typeof change.deletions === "number" &&
              Number.isInteger(change.deletions) &&
              change.deletions >= 0)) &&
          typeof change.occurredAt === "number" &&
          Number.isFinite(change.occurredAt)
        );
      },
    )
    .slice(-128);
}

export function restoreProjectFileProposals(
  value: unknown,
): NonNullable<AssistantTurn["fileProposals"]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (
        candidate,
      ): candidate is NonNullable<AssistantTurn["fileProposals"]>[number] => {
        if (!candidate || typeof candidate !== "object") return false;
        const proposal = candidate as Record<string, unknown>;
        return (
          typeof proposal.callId === "string" &&
          (proposal.sourceCallIds === undefined ||
            (Array.isArray(proposal.sourceCallIds) &&
              proposal.sourceCallIds.length <= 128 &&
              proposal.sourceCallIds.every(
                (callId) => typeof callId === "string" && callId.length > 0,
              ))) &&
          safeRestoredProjectPath(proposal.relativePath) &&
          (proposal.operation === "created" ||
            proposal.operation === "updated") &&
          typeof proposal.proposedRevision === "string" &&
          /^[a-f0-9]{64}$/u.test(proposal.proposedRevision) &&
          (proposal.baseRevision === undefined ||
            proposal.baseRevision === null ||
            (typeof proposal.baseRevision === "string" &&
              /^[a-f0-9]{64}$/u.test(proposal.baseRevision))) &&
          typeof proposal.originalContent === "string" &&
          proposal.originalContent.length <= 256 * 1024 &&
          typeof proposal.proposedContent === "string" &&
          proposal.proposedContent.length <= 256 * 1024 &&
          typeof proposal.additions === "number" &&
          Number.isInteger(proposal.additions) &&
          proposal.additions >= 0 &&
          typeof proposal.deletions === "number" &&
          Number.isInteger(proposal.deletions) &&
          proposal.deletions >= 0 &&
          (proposal.status === "pending" ||
            proposal.status === "accepted" ||
            proposal.status === "rejected" ||
            proposal.status === "mixed") &&
          (proposal.keptChanges === undefined ||
            typeof proposal.keptChanges === "boolean") &&
          (proposal.createdFileCanBeDeleted === undefined ||
            typeof proposal.createdFileCanBeDeleted === "boolean") &&
          (proposal.appliedImmediately === undefined ||
            typeof proposal.appliedImmediately === "boolean") &&
          typeof proposal.occurredAt === "number" &&
          Number.isFinite(proposal.occurredAt)
        );
      },
    )
    .map((proposal) =>
      proposal.status === "pending" && proposal.appliedImmediately !== true
        ? {
            ...proposal,
            status: "rejected" as const,
            error:
              "This review was created by the previous proposal-only workflow and was not applied to disk.",
            resolvedAt: Date.now(),
          }
        : proposal,
    )
    .slice(-128);
}

function safeRestoredProjectPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2_000) return false;
  if (
    value.includes("\0") ||
    /^[\\/]/u.test(value) ||
    /^[a-z]:/iu.test(value)
  ) {
    return false;
  }
  return !value.split(/[\\/]/u).some((segment) => segment === "..");
}
