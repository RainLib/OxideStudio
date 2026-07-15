import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AssistantMode } from "@/ai/assistant/modes";
import type { AiToolPermission, JsonSchema } from "@/ai/tools/types";
import { invokeRawCommand } from "./client";

export const AGENT_HOST_PROTOCOL_VERSION = 1 as const;
export const AGENT_HOST_EVENT_CHANNEL = "agent://event";

export type AgentHostAvailability =
  | "checking"
  | "available"
  | "unavailable";

export type AgentHostStatus = {
  state: string;
  available: boolean;
  protocolVersion: number;
  capabilities: string[];
  binaryPath?: string | null;
  storageMode: string;
  lastError?: string | null;
};

export type AgentProfile = Exclude<AssistantMode, "o2">;

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentProviderCapabilities = {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
};

export type AgentProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  capabilities: AgentProviderCapabilities;
};

export type AgentToolManifestEntry = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  permissions: AiToolPermission[];
  timeoutMs?: number;
  resultLimit?: {
    maxRows?: number;
    maxBytes?: number;
  };
};

export type AgentWorkspaceContext = {
  projectId: string;
  connectionId: string | null;
  database: string | null;
  namespace: string | null;
  activeTabId: string | null;
  configRevision: string | null;
  fingerprint: string;
  summary: Record<string, unknown>;
};

export type AgentRequestMetadata = {
  requestId: string;
  threadId: string;
  turnId: string;
  contextVersion: string;
  deadline: number;
};

export type AgentStartTurnRequest = AgentRequestMetadata & {
  projectId: string;
  profile: AgentProfile;
  messages: AgentMessage[];
  prompt: string;
  provider: AgentProviderConfig;
  workspace: AgentWorkspaceContext;
  tools: AgentToolManifestEntry[];
  resumeCheckpoint?: unknown;
};

export type AgentTurnAccepted = {
  requestId: string;
  threadId: string;
  turnId: string;
  accepted: boolean;
};

export type AgentCancelTurnRequest = AgentRequestMetadata;

export type AgentAnswerClarificationRequest = AgentRequestMetadata & {
  clarificationId: string;
  answers: Record<string, string>;
};

export type AgentApprovalDecision = "approve" | "reject";

export type AgentApproveActionRequest = AgentRequestMetadata & {
  approvalId: string;
  decision: AgentApprovalDecision;
};

export type AgentActionAccepted = {
  accepted: boolean;
};

export type AgentProjectStateCleared = {
  projectId: string;
  clearedRecords: number;
};

type AgentEventBase<TType extends string> = {
  threadId: string;
  turnId: string;
  sequence: number;
  occurredAt: number;
  type: TType;
};

export type AgentClarificationQuestion = {
  id: string;
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
  }>;
  allowFreeText: true;
};

export type AgentHostEvent =
  | (AgentEventBase<"turn.status"> & {
      status:
        | "starting"
        | "planning"
        | "running"
        | "awaiting_input"
        | "awaiting_approval"
        | "completed"
        | "failed"
        | "cancelled";
      label?: string;
    })
  | (AgentEventBase<"plan.changed"> & {
      items: Array<{
        id: string;
        title: string;
        status: "pending" | "running" | "completed" | "failed";
      }>;
    })
  | (AgentEventBase<"tool.started" | "tool.finished"> & {
      callId: string;
      toolName: string;
      label: string;
      success?: boolean;
      detail?: string;
    })
  | (AgentEventBase<"subagent"> & {
      name: string;
      status: "started" | "completed" | "failed";
      detail?: string;
    })
  | (AgentEventBase<"clarification"> & {
      clarificationId: string;
      questions: AgentClarificationQuestion[];
      context?: string;
    })
  | (AgentEventBase<"approval"> & {
      approvalId: string;
      callId: string;
      inputDigest: string;
      toolName: string;
      title: string;
      risk: "write" | "destructive" | "external";
      summary: string;
    })
  | (AgentEventBase<"context.compacted"> & {
      inputTokens: number;
      retainedTokens: number;
      offloadedArtifacts: number;
    })
  | (AgentEventBase<"answer.delta"> & {
      content: string;
      reset: boolean;
    })
  | (AgentEventBase<"final.answer"> & {
      content: string;
      artifacts: string[];
    })
  | (AgentEventBase<"failure"> & {
      code: string;
      message: string;
      retryable: boolean;
    });

export type AgentHostEventListener = (event: AgentHostEvent) => void;

export const agentHostService = {
  getStatus: async (providerConfigured = false): Promise<AgentHostStatus> => {
    return normalizeAgentHostStatus(
      await invokeRawCommand<AgentHostStatus>("agent_get_status", {
        providerConfigured,
      }),
    );
  },

  startTurn: async (
    request: AgentStartTurnRequest,
  ): Promise<AgentTurnAccepted> => {
    return await invokeRawCommand<AgentTurnAccepted>("agent_start_turn", {
      request,
    });
  },

  resumeTurn: async (
    request: AgentStartTurnRequest,
  ): Promise<AgentTurnAccepted> => {
    return await invokeRawCommand<AgentTurnAccepted>("agent_resume_turn", {
      request,
    });
  },

  cancelTurn: async (
    request: AgentCancelTurnRequest,
  ): Promise<AgentActionAccepted> => {
    return await invokeRawCommand<AgentActionAccepted>("agent_cancel_turn", {
      request,
    });
  },

  answerClarification: async (
    request: AgentAnswerClarificationRequest,
  ): Promise<AgentActionAccepted> => {
    return await invokeRawCommand<AgentActionAccepted>(
      "agent_answer_clarification",
      { request },
    );
  },

  approveAction: async (
    request: AgentApproveActionRequest,
  ): Promise<AgentActionAccepted> => {
    return await invokeRawCommand<AgentActionAccepted>("agent_approve_action", {
      request,
    });
  },

  clearProjectState: async (
    projectId: string,
  ): Promise<AgentProjectStateCleared> => {
    return await invokeRawCommand<AgentProjectStateCleared>(
      "agent_clear_project_state",
      { projectId },
    );
  },

  listen: async (listener: AgentHostEventListener): Promise<UnlistenFn> => {
    return await listen<AgentHostEvent>(AGENT_HOST_EVENT_CHANNEL, (event) => {
      if (!isAgentHostEvent(event.payload)) return;
      listener(event.payload);
    });
  },
};

export function isAgentHostUnavailableError(error: unknown) {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? "");
  return /(?:agent[_ -](?:host|start|resume|cancel|get|answer|approve)|command .* not found|unknown command|sidecar|not available|unavailable|failed to spawn)/iu.test(
    text,
  );
}

function normalizeAgentHostStatus(status: AgentHostStatus): AgentHostStatus {
  if (status.protocolVersion !== AGENT_HOST_PROTOCOL_VERSION) {
    return {
      ...status,
      available: false,
      state: "failed",
      lastError: `Unsupported agent host protocol ${status.protocolVersion}; expected ${AGENT_HOST_PROTOCOL_VERSION}.`,
    };
  }
  return status;
}

function isAgentHostEvent(value: unknown): value is AgentHostEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const hasBase =
    typeof event.threadId === "string" &&
    typeof event.turnId === "string" &&
    typeof event.type === "string" &&
    typeof event.sequence === "number" &&
    typeof event.occurredAt === "number";
  if (!hasBase) return false;

  switch (event.type) {
    case "turn.status":
      return (
        typeof event.status === "string" &&
        [
          "starting",
          "planning",
          "running",
          "awaiting_input",
          "awaiting_approval",
          "completed",
          "failed",
          "cancelled",
        ].includes(event.status)
      );
    case "plan.changed":
      return (
        Array.isArray(event.items) &&
        event.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.status === "string" &&
            ["pending", "running", "completed", "failed"].includes(
              item.status,
            ),
        )
      );
    case "tool.started":
    case "tool.finished":
      return (
        typeof event.callId === "string" &&
        typeof event.toolName === "string" &&
        typeof event.label === "string"
      );
    case "subagent":
      return (
        typeof event.name === "string" &&
        typeof event.status === "string" &&
        ["started", "completed", "failed"].includes(event.status)
      );
    case "clarification":
      return (
        typeof event.clarificationId === "string" &&
        Array.isArray(event.questions) &&
        event.questions.every(
          (question) =>
            isRecord(question) &&
            typeof question.id === "string" &&
            typeof question.prompt === "string" &&
            question.allowFreeText === true &&
            Array.isArray(question.options) &&
            question.options.every(
              (option) =>
                isRecord(option) &&
                typeof option.id === "string" &&
                typeof option.label === "string",
            ),
        )
      );
    case "approval":
      return (
        typeof event.approvalId === "string" &&
        typeof event.callId === "string" &&
        typeof event.inputDigest === "string" &&
        typeof event.toolName === "string" &&
        typeof event.title === "string" &&
        typeof event.summary === "string" &&
        typeof event.risk === "string" &&
        ["write", "destructive", "external"].includes(event.risk)
      );
    case "context.compacted":
      return (
        typeof event.inputTokens === "number" &&
        typeof event.retainedTokens === "number" &&
        typeof event.offloadedArtifacts === "number"
      );
    case "answer.delta":
      return typeof event.content === "string" && typeof event.reset === "boolean";
    case "final.answer":
      return (
        typeof event.content === "string" &&
        Array.isArray(event.artifacts) &&
        event.artifacts.every((artifact) => typeof artifact === "string")
      );
    case "failure":
      return (
        typeof event.code === "string" &&
        typeof event.message === "string" &&
        typeof event.retryable === "boolean"
      );
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
