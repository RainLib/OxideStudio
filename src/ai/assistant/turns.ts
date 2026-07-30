import type { AssistantMode, ResolvedAssistantMode } from "./modes";
import type { AssistantConversationMessage } from "./types";
import type { AssistantAttachment } from "@/ai/ui-actions/types";
import type { AgentCitation } from "@/services/tauri/agent-host.service";

export type AssistantTurnStatus =
  | "queued"
  | "planning"
  | "running"
  | "awaiting_input"
  | "awaiting_approval"
  | "paused"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type AssistantProcessStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AssistantProcessItemKind =
  | "planning"
  | "commentary"
  | "step"
  | "tool"
  | "clarification"
  | "checkpoint"
  | "compaction"
  | "warning";

export type AssistantProcessItem = {
  id: string;
  sequence: number;
  kind: AssistantProcessItemKind;
  title: string;
  detail?: string | null;
  toolName?: string | null;
  relativePath?: string | null;
  additions?: number;
  deletions?: number;
  status: AssistantProcessStatus;
  startedAt: number;
  finishedAt?: number | null;
};

export type AssistantClarificationOption = {
  id: string;
  label: string;
  description?: string | null;
  value?: string | null;
};

export type AssistantClarification = {
  clarificationId: string;
  questionId: string;
  question: string;
  context?: string | null;
  options: AssistantClarificationOption[];
  allowFreeText: boolean;
  answer?: string | null;
  answeredAt?: number | null;
};

export type AssistantApprovalRisk =
  | "write"
  | "destructive"
  | "external"
  | "unknown";

export type AssistantApproval = {
  approvalId: string;
  callId: string;
  title: string;
  summary: string;
  toolName?: string | null;
  risk: AssistantApprovalRisk;
  inputDigest: string;
  policyDigest?: string | null;
  findings?: Array<{
    ruleId: string;
    decision: "allow" | "confirm" | "block";
    title: string;
    detail: string;
    evidence?: string;
  }>;
  confirmation?: {
    kind: "phrase";
    phrase: string;
    prompt: string;
  } | null;
  decision?: "approved" | "rejected" | null;
  decidedAt?: number | null;
};

export type AssistantFinalMessage = {
  content: string;
  attachments: AssistantAttachment[];
  artifactRefs?: string[];
  citations?: AgentCitation[];
  createdAt: number;
};

export type AssistantContextCompactionStats = {
  count: number;
  lastInputTokens: number;
  lastRetainedTokens: number;
  offloadedArtifacts: number;
};

export type AssistantModelUsageStats = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AssistantProjectFileChange = {
  callId: string;
  relativePath: string;
  operation: "created" | "updated";
  revision: string;
  previousRevision?: string | null;
  introducedLines?: number[];
  lineEvidenceTruncated?: boolean;
  additions?: number;
  deletions?: number;
  occurredAt: number;
};

export type AssistantProjectFileProposal = {
  callId: string;
  sourceCallIds?: string[];
  relativePath: string;
  operation: "created" | "updated";
  proposedRevision: string;
  baseRevision?: string | null;
  originalContent: string;
  proposedContent: string;
  additions: number;
  deletions: number;
  status: "pending" | "accepted" | "rejected" | "mixed";
  keptChanges?: boolean;
  createdFileCanBeDeleted?: boolean;
  appliedImmediately?: boolean;
  isApplying?: boolean;
  error?: string | null;
  occurredAt: number;
  resolvedAt?: number | null;
};

export type AssistantTurn = {
  id: string;
  requestId: string;
  threadId?: string | null;
  projectId: string;
  requestedMode: AssistantMode;
  mode: ResolvedAssistantMode;
  userMessage: string;
  userAttachments?: Array<{
    id: string;
    fileName: string;
    byteCount: number;
  }>;
  status: AssistantTurnStatus;
  process: AssistantProcessItem[];
  clarifications: AssistantClarification[];
  approvals: AssistantApproval[];
  draft: string;
  final?: AssistantFinalMessage | null;
  contextCompaction?: AssistantContextCompactionStats | null;
  modelUsage?: AssistantModelUsageStats | null;
  fileChanges?: AssistantProjectFileChange[];
  fileProposals?: AssistantProjectFileProposal[];
  error?: string | null;
  errorDetail?: string | null;
  createdAt: number;
  updatedAt: number;
  lastEventSequence?: number;
};

export type CreateAssistantTurnInput = Pick<
  AssistantTurn,
  | "id"
  | "requestId"
  | "projectId"
  | "requestedMode"
  | "mode"
  | "userMessage"
> & {
  now?: number;
};

export function createAssistantTurn(
  input: CreateAssistantTurnInput,
): AssistantTurn {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    requestId: input.requestId,
    projectId: input.projectId,
    requestedMode: input.requestedMode,
    mode: input.mode,
    userMessage: input.userMessage,
    status: "planning",
    process: [],
    clarifications: [],
    approvals: [],
    draft: "",
    final: null,
    contextCompaction: null,
    modelUsage: null,
    error: null,
    errorDetail: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Only user-visible questions and final answers are model history. Planning,
 * tool activity, approvals and audit detail remain inspectable UI state but
 * never become conversational messages.
 */
export function assistantConversationHistoryFromTurns(
  turns: readonly AssistantTurn[],
): AssistantConversationMessage[] {
  return turns.flatMap((turn): AssistantConversationMessage[] => {
    const answeredClarifications = turn.clarifications.filter((clarification) =>
      Boolean(clarification.answer?.trim()),
    );
    if (!turn.final?.content.trim() && answeredClarifications.length === 0) {
      return [];
    }
    const history: AssistantConversationMessage[] = [
      { role: "user", content: turn.userMessage },
    ];
    for (const clarification of answeredClarifications) {
      history.push(
        { role: "assistant", content: clarification.question },
        { role: "user", content: clarification.answer!.trim() },
      );
    }
    if (turn.final?.content.trim()) {
      history.push({ role: "assistant", content: turn.final.content.trim() });
    }
    return history;
  });
}

export function assistantTurnAnswer(turn: AssistantTurn) {
  if (turn.final?.content.trim()) return turn.final.content.trim();
  if (turn.status === "failed" && turn.error?.trim()) return turn.error.trim();
  if (turn.status === "cancelled") return "Cancelled";
  if (turn.draft.trim()) return turn.draft.trim();
  return "Waiting for an answer";
}

export function assistantTurnIsActive(turn: AssistantTurn) {
  return [
    "queued",
    "planning",
    "running",
    "awaiting_input",
    "awaiting_approval",
    "cancelling",
  ].includes(turn.status);
}

export function assistantTurnCanCancel(turn: AssistantTurn) {
  return assistantTurnIsActive(turn) && turn.status !== "cancelling";
}

export function assistantTurnCanResume(turn: AssistantTurn) {
  return turn.status === "paused";
}

export function upsertAssistantProcessItem(
  process: readonly AssistantProcessItem[],
  item: AssistantProcessItem,
) {
  const existingIndex = process.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex < 0) {
    return [...process, item].sort(compareProcessItems);
  }
  return process
    .map((candidate, index) =>
      index === existingIndex
        ? {
            ...candidate,
            ...item,
            sequence: candidate.sequence,
            startedAt: candidate.startedAt,
          }
        : candidate,
    )
    .sort(compareProcessItems);
}

function compareProcessItems(
  left: AssistantProcessItem,
  right: AssistantProcessItem,
) {
  return left.sequence - right.sequence || left.startedAt - right.startedAt;
}
