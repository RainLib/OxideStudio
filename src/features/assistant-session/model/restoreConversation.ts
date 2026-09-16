import { type AssistantTurn } from "@/ai/assistant/turns";
import {
  restoreProjectFileChanges,
  restoreProjectFileProposals,
} from "@/features/assistant-session/model/restoreFileReview";
import {
  isAgentCitation,
  type AgentStartTurnRequest,
} from "@/services/tauri/agent-host.service";

export function restoreConversationTurns(value: unknown): AssistantTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is AssistantTurn => {
      if (!candidate || typeof candidate !== "object") return false;
      const turn = candidate as Partial<AssistantTurn>;
      return (
        typeof turn.id === "string" &&
        typeof turn.projectId === "string" &&
        typeof turn.userMessage === "string" &&
        typeof turn.status === "string" &&
        Array.isArray(turn.process) &&
        Array.isArray(turn.approvals) &&
        Array.isArray(turn.clarifications)
      );
    })
    .map((turn) => ({
      ...turn,
      draft: typeof turn.draft === "string" ? turn.draft : "",
      error:
        typeof turn.error === "string" || turn.error === null
          ? turn.error
          : null,
      errorDetail:
        typeof turn.errorDetail === "string" || turn.errorDetail === null
          ? turn.errorDetail
          : null,
      final: restoreAssistantFinal(turn.final, turn.updatedAt),
      fileChanges: restoreProjectFileChanges(turn.fileChanges),
      fileProposals: restoreProjectFileProposals(turn.fileProposals),
    }))
    .slice(-100);
}

function restoreAssistantFinal(
  value: unknown,
  fallbackCreatedAt: number,
): AssistantTurn["final"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const final = value as Record<string, unknown>;
  const artifactRefs = Array.isArray(final.artifactRefs)
    ? final.artifactRefs
        .filter(
          (reference): reference is string =>
            typeof reference === "string" && reference.length <= 2_000,
        )
        .slice(0, 128)
    : [];
  return {
    content: typeof final.content === "string" ? final.content : "",
    attachments: Array.isArray(final.attachments)
      ? final.attachments.filter(isRestoredAssistantAttachment).slice(0, 32)
      : [],
    ...(artifactRefs.length > 0 ? { artifactRefs } : {}),
    citations: Array.isArray(final.citations)
      ? final.citations.filter(isAgentCitation).slice(0, 8)
      : [],
    createdAt:
      typeof final.createdAt === "number" && Number.isFinite(final.createdAt)
        ? final.createdAt
        : Number.isFinite(fallbackCreatedAt)
          ? fallbackCreatedAt
          : Date.now(),
  };
}

function isRestoredAssistantAttachment(
  value: unknown,
): value is NonNullable<AssistantTurn["final"]>["attachments"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.kind === "string" &&
    typeof attachment.label === "string" &&
    isRestoredUiAction(attachment.action) &&
    (attachment.secondaryActions === undefined ||
      (Array.isArray(attachment.secondaryActions) &&
        attachment.secondaryActions.every(isRestoredUiAction)))
  );
}

function isRestoredUiAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  const target = action.target;
  const issuedAgainst = action.issuedAgainst;
  const presentation = action.presentation;
  return (
    typeof action.id === "string" &&
    typeof action.action === "string" &&
    Boolean(target && typeof target === "object" && !Array.isArray(target)) &&
    Boolean(
      issuedAgainst &&
        typeof issuedAgainst === "object" &&
        !Array.isArray(issuedAgainst),
    ) &&
    Boolean(
      presentation &&
        typeof presentation === "object" &&
        !Array.isArray(presentation) &&
        typeof (presentation as Record<string, unknown>).label === "string",
    )
  );
}

export function restoreConversationRequests(
  value: unknown,
): AgentStartTurnRequest[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is AgentStartTurnRequest => {
    if (!candidate || typeof candidate !== "object") return false;
    const request = candidate as Partial<AgentStartTurnRequest>;
    return (
      typeof request.requestId === "string" &&
      typeof request.threadId === "string" &&
      typeof request.turnId === "string" &&
      typeof request.projectId === "string" &&
      typeof request.prompt === "string" &&
      Boolean(request.provider) &&
      Boolean(request.workspace)
    );
  });
}
