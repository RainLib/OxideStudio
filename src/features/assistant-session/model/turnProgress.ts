import {
  upsertAssistantProcessItem,
  type AssistantApproval,
  type AssistantClarification,
  type AssistantProcessItem,
  type AssistantProcessStatus,
  type AssistantTurn,
  type AssistantTurnStatus,
} from "@/ai/assistant/turns";
import { type AgentHostEvent } from "@/services/tauri/agent-host.service";

export function hasRecentProcessDescription(
  process: readonly AssistantProcessItem[],
  occurredAt: number,
) {
  const latest = [...process]
    .reverse()
    .find((item) => item.kind === "commentary");
  return Boolean(
    latest &&
      latest.startedAt <= occurredAt &&
      occurredAt - latest.startedAt <= 15_000,
  );
}

export function fallbackToolPhaseDescription(toolName: string, label: string) {
  if (toolName === "project.listFiles") {
    return "I’ll review the project structure to locate the relevant files.";
  }
  if (toolName === "project.readFile") {
    return "I’ll read the relevant project file before deciding what needs to change.";
  }
  if (toolName === "project.writeFile") {
    return "I’ll update the requested project file and leave the change available for review or undo.";
  }
  if (toolName === "shell.execute") {
    return "I’ll run the approved command in the active project and report its bounded output.";
  }
  if (toolName.startsWith("metadata.")) {
    return "I’ll inspect the relevant database metadata before continuing.";
  }
  if (toolName.startsWith("query.")) {
    return "I’ll check the query with a bounded, read-only database operation.";
  }
  if (toolName.startsWith("lsp.")) {
    return "I’ll inspect the editor diagnostics before proposing the next change.";
  }
  if (toolName.startsWith("editor.")) {
    return "I’ll prepare a reviewable editor change without applying it automatically.";
  }
  return `I’ll ${label.toLocaleLowerCase()} for this stage.`;
}

export function reduceTurnStatus(
  turn: AssistantTurn,
  event: Extract<AgentHostEvent, { type: "turn.status" }>,
  common: Pick<AssistantTurn, "threadId" | "lastEventSequence" | "updatedAt">,
): AssistantTurn {
  const status =
    event.status === "failed" && turn.status === "paused"
      ? "paused"
      : turnStatus(event.status);
  let process = turn.process;
  if (event.status === "starting" || event.status === "planning") {
    process = upsertAssistantProcessItem(
      process,
      processItem(event, "planning", {
        id: "status:planning",
        title: event.label || "Preparing the response",
        status: "running",
      }),
    );
  } else if (event.status === "running") {
    process = finishProcessItem(process, "status:planning", event.occurredAt);
  } else if (["completed", "failed", "cancelled"].includes(event.status)) {
    process = finishRunningProcess(
      process,
      event.status === "completed"
        ? "completed"
        : event.status === "cancelled"
          ? "cancelled"
          : "failed",
      event.occurredAt,
    );
  }
  return {
    ...turn,
    ...common,
    status,
    process,
    error:
      event.status === "failed"
        ? turn.error ||
          event.label ||
          "The assistant could not complete this task."
        : event.status === "completed"
          ? null
          : turn.error,
    errorDetail: event.status === "completed" ? null : turn.errorDetail,
  };
}

function turnStatus(
  status: Extract<AgentHostEvent, { type: "turn.status" }>["status"],
): AssistantTurnStatus {
  if (status === "starting" || status === "planning") return "planning";
  return status;
}

export function processItem(
  event: AgentHostEvent,
  kind: AssistantProcessItem["kind"],
  item: Omit<AssistantProcessItem, "kind" | "sequence" | "startedAt">,
): AssistantProcessItem {
  return {
    ...item,
    kind,
    sequence: event.sequence,
    startedAt: event.occurredAt,
    finishedAt:
      item.status === "running" || item.status === "pending"
        ? null
        : event.occurredAt,
  };
}

function finishProcessItem(
  process: readonly AssistantProcessItem[],
  id: string,
  finishedAt: number,
) {
  return process.map((item) =>
    item.id === id && item.status === "running"
      ? { ...item, status: "completed" as const, finishedAt }
      : item,
  );
}

export function finishRunningProcess(
  process: readonly AssistantProcessItem[],
  status: Exclude<AssistantProcessStatus, "pending" | "running">,
  finishedAt: number,
) {
  return process.map((item) =>
    item.status === "running" ? { ...item, status, finishedAt } : item,
  );
}

export function upsertClarification(
  clarifications: readonly AssistantClarification[],
  clarification: AssistantClarification,
) {
  const key = clarificationKey(clarification);
  const exists = clarifications.some(
    (candidate) => clarificationKey(candidate) === key,
  );
  return exists
    ? clarifications.map((candidate) =>
        clarificationKey(candidate) === key
          ? {
              ...candidate,
              ...clarification,
              answer: candidate.answer,
              answeredAt: candidate.answeredAt,
            }
          : candidate,
      )
    : [...clarifications, clarification];
}

function clarificationKey(clarification: AssistantClarification) {
  return `${clarification.clarificationId}:${clarification.questionId}`;
}

export function upsertApproval(
  approvals: readonly AssistantApproval[],
  approval: AssistantApproval,
) {
  const exists = approvals.some(
    (candidate) => candidate.approvalId === approval.approvalId,
  );
  return exists
    ? approvals.map((candidate) =>
        candidate.approvalId === approval.approvalId
          ? {
              ...candidate,
              ...approval,
              decision: candidate.decision,
              decidedAt: candidate.decidedAt,
            }
          : candidate,
      )
    : [...approvals, approval];
}

export function nextProcessSequence(process: readonly AssistantProcessItem[]) {
  return (
    process.reduce((sequence, item) => Math.max(sequence, item.sequence), 0) + 1
  );
}

export function clarificationAnswerLabel(
  clarification: AssistantClarification,
) {
  const answer = clarification.answer?.trim() ?? "";
  const option = clarification.options.find(
    (candidate) => (candidate.value || candidate.label) === answer,
  );
  return option?.label ?? answer;
}

export function visibleProgressHeadline(content: string) {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117).trimEnd()}...`;
}

export function visibleProgressDetail(content: string) {
  const normalized = content.trim();
  const headline = visibleProgressHeadline(normalized);
  if (normalized === headline) return null;
  if (normalized.length <= 2_000) return normalized;
  return `${normalized.slice(0, 1_997).trimEnd()}...`;
}
