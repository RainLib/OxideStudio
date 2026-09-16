import type { AssistantMode } from "@/ai/assistant/modes";
import { type AssistantTurn } from "@/ai/assistant/turns";
import { type LineDiffHunk } from "@/lib/lineDiff";
import {
  agentHostService,
  type AgentApprovalDecision,
  type AgentContextMetrics,
  type AgentHostAvailability,
  type AgentHostStatus,
  type AgentProviderConfig,
  type AgentStartTurnRequest,
} from "@/services/tauri/agent-host.service";

export type ConversationSnapshotSaveRequest = Parameters<
  typeof agentHostService.saveConversationSnapshot
>[0];

export type PendingConversationSnapshot = {
  scope: string;
  request: ConversationSnapshotSaveRequest;
};

export type LiveConversationState = {
  threadId: string;
  turns: AssistantTurn[];
  resumeRequests: Map<string, AgentStartTurnRequest>;
  updatedAt: number;
};

export type AssistantAgentStartTurnRequest = Omit<
  AgentStartTurnRequest,
  "threadId" | "contextVersion" | "deadline" | "provider"
> & {
  requestedMode: AssistantMode;
  contextVersion: string;
  deadline?: number;
  provider: AgentProviderConfig | null;
  displayMessage?: string;
  inputAttachments?: Array<{
    id: string;
    fileName: string;
    byteCount: number;
  }>;
};

export type AssistantAgentSession = {
  turns: AssistantTurn[];
  activeTurn: AssistantTurn | null;
  /** A persisted snapshot and its journal are still being reconciled. */
  isHydrating: boolean;
  hydrationError: string | null;
  availability: AgentHostAvailability;
  hostStatus: AgentHostStatus | null;
  hostError: string | null;
  contextMetrics: AgentContextMetrics | null;
  isBusy: boolean;
  startTurn: (request: AssistantAgentStartTurnRequest) => Promise<void>;
  answerClarification: (
    turnId: string,
    clarificationId: string,
    answers: Record<string, string>,
    contextFingerprint: string,
  ) => Promise<void>;
  decideApproval: (
    turnId: string,
    approvalId: string,
    decision: AgentApprovalDecision,
    contextFingerprint: string,
    confirmationText?: string,
  ) => Promise<void>;
  cancelTurn: (turnId: string) => Promise<void>;
  resumeTurn: (turnId: string, contextFingerprint: string) => Promise<void>;
  keepFileChange: (turnId: string, callId: string) => void;
  undoFileChange: (
    turnId: string,
    callId: string,
    expectedRoot?: string | null,
  ) => Promise<void>;
  keepFileChangeHunk: (
    turnId: string,
    callId: string,
    hunk: LineDiffHunk,
  ) => void;
  undoFileChangeHunk: (
    turnId: string,
    callId: string,
    hunk: LineDiffHunk,
    expectedRoot?: string | null,
  ) => Promise<void>;
  clear: () => void;
  retryHydration: () => void;
  refreshStatus: () => Promise<void>;
};
