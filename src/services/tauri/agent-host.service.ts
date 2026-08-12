import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AssistantMode } from "@/ai/assistant/modes";
import type { AiToolPermission, JsonSchema } from "@/ai/tools/types";
import type {
  AiCliProviderConfig,
  AiHttpProviderConfig,
  AiProviderKind,
} from "./ai.service";
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
  installedTools: string[];
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

export type AgentProviderConfig = (
  | AiHttpProviderConfig
  | AiCliProviderConfig
) & {
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

export type CommandPolicyFinding = {
  ruleId: string;
  decision: "allow" | "confirm" | "block";
  title: string;
  detail: string;
  evidence?: string;
};

export type CommandConfirmation = {
  kind: "phrase";
  phrase: string;
  prompt: string;
};

export type AgentApproveActionRequest = AgentRequestMetadata & {
  approvalId: string;
  decision: AgentApprovalDecision;
  confirmationText?: string;
};

export type AgentActionAccepted = {
  accepted: boolean;
};

export type AgentProjectStateCleared = {
  projectId: string;
  clearedRecords: number;
};

export type AgentContextMetrics = {
  projectId: string;
  compaction: {
    count: number;
    lastInputTokens: number;
    lastRetainedTokens: number;
    offloadedArtifacts: number;
  } | null;
  modelUsage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  updatedAt: number;
};

export type AgentConversationSnapshot = {
    projectId: string;
    conversationId?: string | null;
  threadId: string;
  turns: unknown;
  resumeRequests: unknown;
  updatedAt: number;
};

export type AgentTextAttachment = {
  fileName: string;
  content: string;
  byteCount: number;
};

export type AgentArtifactReadResult = {
  artifactId: string;
  found: boolean;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  eof: boolean;
  content: string;
};

export type AgentArtifactSearchResult = {
  artifactId: string;
  query: string;
  found: boolean;
  totalBytes: number;
  matchCount: number;
  truncated: boolean;
  matches: Array<{
    offset: number;
    length: number;
    snippetOffset: number;
    snippet: string;
  }>;
};

export type AgentArtifactExportResult = {
  artifactId: string;
  exported: boolean;
  filePath: string | null;
  byteCount: number;
};

export type AgentCitation = {
  id: string;
  kind: "databaseSchema" | "databaseObject" | "planNode";
  label: string;
  detail?: string;
  toolName: string;
  projectId: string;
  connectionId?: string;
  databaseName?: string;
  schemaName?: string;
  objectName?: string;
  objectType?: string;
  tabId?: string;
  planId?: string;
  nodeId?: string;
};

type AgentEventBase<TType extends string> = {
  threadId: string;
  turnId: string;
  sequence: number;
  occurredAt: number;
  type: TType;
  projectMetrics?: AgentContextMetrics;
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
      relativePath?: string;
      success?: boolean;
      detail?: string;
    })
  | (AgentEventBase<"file.changed"> & {
      callId: string;
      relativePath: string;
      operation: "created" | "updated";
      revision: string;
      previousRevision?: string | null;
      introducedLines?: number[];
      lineEvidenceTruncated?: boolean;
      originalContent?: string;
      appliedContent?: string;
      additions?: number;
      deletions?: number;
      reviewable?: boolean;
    })
  | (AgentEventBase<"file.proposed"> & {
      callId: string;
      relativePath: string;
      operation: "created" | "updated";
      proposedRevision: string;
      baseRevision?: string | null;
      originalContent: string;
      proposedContent: string;
      additions: number;
      deletions: number;
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
      policyDigest?: string;
      findings?: CommandPolicyFinding[];
      confirmation?: CommandConfirmation;
    })
  | (AgentEventBase<"context.compacted"> & {
      inputTokens: number;
      retainedTokens: number;
      offloadedArtifacts: number;
    })
  | (AgentEventBase<"model.usage"> & {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    })
  | (AgentEventBase<"provider.activity"> & {
      provider: "codex-cli" | "codebuddy-cli";
      status: "starting" | "running" | "completed" | "error";
      label: string;
      detail?: string;
    })
  | (AgentEventBase<"answer.delta"> & {
      content: string;
      reset: boolean;
    })
  | (AgentEventBase<"final.answer"> & {
      content: string;
      artifacts: string[];
      citations?: AgentCitation[];
    })
  | (AgentEventBase<"failure"> & {
      code: string;
      message: string;
      retryable: boolean;
    });

export type AgentHostEventListener = (event: AgentHostEvent) => void;

export const agentHostService = {
  getStatus: async (
    providerConfigured = false,
    providerKind?: AiProviderKind,
  ): Promise<AgentHostStatus> => {
    return normalizeAgentHostStatus(
      await invokeRawCommand<AgentHostStatus>("agent_get_status", {
        providerConfigured,
        ...(providerKind ? { providerKind } : {}),
      }),
    );
  },

  getContextMetrics: async (
    projectId: string,
  ): Promise<AgentContextMetrics> => {
    return await invokeRawCommand<AgentContextMetrics>(
      "agent_get_context_metrics",
      { projectId },
    );
  },

  saveConversationSnapshot: async (request: {
      projectId: string;
      conversationId?: string;
    threadId: string;
    turns: unknown[];
    resumeRequests: AgentStartTurnRequest[];
  }): Promise<AgentConversationSnapshot> => {
    return await invokeRawCommand<AgentConversationSnapshot>(
      "agent_save_conversation_snapshot",
      { request },
    );
  },

  loadConversationSnapshot: async (
      projectId: string,
      conversationId?: string,
  ): Promise<AgentConversationSnapshot | null> => {
    return await invokeRawCommand<AgentConversationSnapshot | null>(
      "agent_load_conversation_snapshot",
        { projectId, conversationId },
    );
  },

  importTextAttachment: async (): Promise<AgentTextAttachment | null> => {
    return await invokeRawCommand<AgentTextAttachment | null>(
      "agent_import_text_attachment",
    );
  },

  readArtifact: async (request: {
    projectId: string;
    artifactId: string;
    offset?: number;
    maxBytes?: number;
  }): Promise<AgentArtifactReadResult> => {
    return await invokeRawCommand<AgentArtifactReadResult>(
      "agent_read_artifact",
      { request },
    );
  },

  searchArtifact: async (request: {
    projectId: string;
    artifactId: string;
    query: string;
    maxMatches?: number;
    contextBytes?: number;
  }): Promise<AgentArtifactSearchResult> => {
    return await invokeRawCommand<AgentArtifactSearchResult>(
      "agent_search_artifact",
      { request },
    );
  },

  exportArtifact: async (request: {
    projectId: string;
    artifactId: string;
    suggestedFileName?: string | null;
  }): Promise<AgentArtifactExportResult> => {
    return await invokeRawCommand<AgentArtifactExportResult>(
      "agent_export_artifact",
      { request },
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
  const normalized = {
    ...status,
    capabilities: Array.isArray(status.capabilities) ? status.capabilities : [],
    installedTools: Array.isArray(status.installedTools)
      ? status.installedTools
      : [],
  };
  if (status.protocolVersion !== AGENT_HOST_PROTOCOL_VERSION) {
    return {
      ...normalized,
      available: false,
      state: "failed",
      lastError: `Unsupported agent host protocol ${status.protocolVersion}; expected ${AGENT_HOST_PROTOCOL_VERSION}.`,
    };
  }
  return normalized;
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
  if (
    !hasBase ||
    (event.projectMetrics !== undefined &&
      !isAgentContextMetrics(event.projectMetrics))
  ) {
    return false;
  }

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
        typeof event.label === "string" &&
        (event.relativePath === undefined ||
          isSafeAgentRelativePath(event.relativePath))
      );
    case "file.changed":
      return (
        typeof event.callId === "string" &&
        isSafeAgentRelativePath(event.relativePath) &&
        (event.operation === "created" || event.operation === "updated") &&
        typeof event.revision === "string" &&
        /^[a-f0-9]{64}$/u.test(event.revision) &&
        (event.previousRevision === undefined ||
          event.previousRevision === null ||
          (typeof event.previousRevision === "string" &&
            /^[a-f0-9]{64}$/u.test(event.previousRevision))) &&
        (event.introducedLines === undefined ||
          (Array.isArray(event.introducedLines) &&
            event.introducedLines.length <= 2_048 &&
            event.introducedLines.every(
              (line, index, lines) =>
                Number.isInteger(line) &&
                line > 0 &&
                (index === 0 || line > lines[index - 1]!),
            ))) &&
        (event.lineEvidenceTruncated === undefined ||
          typeof event.lineEvidenceTruncated === "boolean") &&
        (event.originalContent === undefined ||
          (typeof event.originalContent === "string" &&
            event.originalContent.length <= 256 * 1024)) &&
        (event.appliedContent === undefined ||
          (typeof event.appliedContent === "string" &&
            event.appliedContent.length <= 256 * 1024)) &&
        (event.additions === undefined ||
          (typeof event.additions === "number" &&
            Number.isInteger(event.additions) &&
            event.additions >= 0)) &&
        (event.deletions === undefined ||
          (typeof event.deletions === "number" &&
            Number.isInteger(event.deletions) &&
            event.deletions >= 0)) &&
        (event.reviewable === undefined ||
          typeof event.reviewable === "boolean") &&
        (event.reviewable !== true ||
          (typeof event.originalContent === "string" &&
            typeof event.appliedContent === "string" &&
            typeof event.additions === "number" &&
            typeof event.deletions === "number"))
      );
    case "file.proposed":
      return (
        typeof event.callId === "string" &&
        isSafeAgentRelativePath(event.relativePath) &&
        (event.operation === "created" || event.operation === "updated") &&
        typeof event.proposedRevision === "string" &&
        /^[a-f0-9]{64}$/u.test(event.proposedRevision) &&
        (event.baseRevision === undefined ||
          event.baseRevision === null ||
          (typeof event.baseRevision === "string" &&
            /^[a-f0-9]{64}$/u.test(event.baseRevision))) &&
        typeof event.originalContent === "string" &&
        event.originalContent.length <= 256 * 1024 &&
        typeof event.proposedContent === "string" &&
        event.proposedContent.length <= 256 * 1024 &&
        typeof event.additions === "number" &&
        Number.isInteger(event.additions) &&
        event.additions >= 0 &&
        typeof event.deletions === "number" &&
        Number.isInteger(event.deletions) &&
        event.deletions >= 0
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
        ["write", "destructive", "external"].includes(event.risk) &&
        (event.policyDigest === undefined ||
          typeof event.policyDigest === "string") &&
        (event.findings === undefined ||
          (Array.isArray(event.findings) &&
            event.findings.every(
              (finding) =>
                isRecord(finding) &&
                typeof finding.ruleId === "string" &&
                typeof finding.title === "string" &&
                typeof finding.detail === "string" &&
                ["allow", "confirm", "block"].includes(
                  String(finding.decision),
                ),
            ))) &&
        (event.confirmation === undefined ||
          (isRecord(event.confirmation) &&
            event.confirmation.kind === "phrase" &&
            typeof event.confirmation.phrase === "string" &&
            typeof event.confirmation.prompt === "string"))
      );
    case "context.compacted":
      return (
        typeof event.inputTokens === "number" &&
        typeof event.retainedTokens === "number" &&
        typeof event.offloadedArtifacts === "number"
      );
    case "model.usage":
      return (
        typeof event.calls === "number" &&
        event.calls > 0 &&
        typeof event.inputTokens === "number" &&
        typeof event.outputTokens === "number" &&
        typeof event.totalTokens === "number"
      );
    case "provider.activity":
      return (
        (event.provider === "codex-cli" ||
          event.provider === "codebuddy-cli") &&
        typeof event.status === "string" &&
        ["starting", "running", "completed", "error"].includes(
          event.status,
        ) &&
        typeof event.label === "string" &&
        (event.detail === undefined || typeof event.detail === "string")
      );
    case "answer.delta":
      return typeof event.content === "string" && typeof event.reset === "boolean";
    case "final.answer":
      return (
        typeof event.content === "string" &&
        Array.isArray(event.artifacts) &&
        event.artifacts.every((artifact) => typeof artifact === "string") &&
        (event.citations === undefined ||
          (Array.isArray(event.citations) &&
            event.citations.length <= 8 &&
            event.citations.every(isAgentCitation)))
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

export function isAgentCitation(value: unknown): value is AgentCitation {
  if (!isRecord(value)) return false;
  const optionalStrings = [
    ["detail", 500],
    ["connectionId", 240],
    ["databaseName", 240],
    ["schemaName", 240],
    ["objectName", 240],
    ["objectType", 120],
    ["tabId", 240],
    ["planId", 240],
    ["nodeId", 240],
  ] as const;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 80 ||
    typeof value.label !== "string" ||
    !value.label ||
    value.label.length > 200 ||
    typeof value.toolName !== "string" ||
    !value.toolName ||
    value.toolName.length > 120 ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    value.projectId.length > 240 ||
    optionalStrings.some(
      ([key, max]) =>
        value[key] !== undefined &&
        (typeof value[key] !== "string" ||
          value[key].length === 0 ||
          value[key].length > max),
    )
  ) {
    return false;
  }
  if (value.kind === "databaseSchema") {
    return [value.connectionId, value.schemaName].every(
      (entry) => typeof entry === "string" && entry.length > 0,
    );
  }
  if (value.kind === "databaseObject") {
    return [value.connectionId, value.schemaName, value.objectName].every(
      (entry) => typeof entry === "string" && entry.length > 0,
    );
  }
  if (value.kind === "planNode") {
    return [value.tabId, value.planId, value.nodeId].every(
      (entry) => typeof entry === "string" && entry.length > 0,
    );
  }
  return false;
}

function isSafeAgentRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2_000) return false;
  if (value.includes("\0") || /^[\\/]/u.test(value) || /^[a-z]:/iu.test(value)) {
    return false;
  }
  return !value.split(/[\\/]/u).some((segment) => segment === "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentContextMetrics(value: unknown): value is AgentContextMetrics {
  if (!isRecord(value)) return false;
  const compaction = value.compaction;
  const modelUsage = value.modelUsage;
  return (
    typeof value.projectId === "string" &&
    typeof value.updatedAt === "number" &&
    (compaction === null ||
      (isRecord(compaction) &&
        typeof compaction.count === "number" &&
        typeof compaction.lastInputTokens === "number" &&
        typeof compaction.lastRetainedTokens === "number" &&
        typeof compaction.offloadedArtifacts === "number")) &&
    (modelUsage === null ||
      (isRecord(modelUsage) &&
        typeof modelUsage.calls === "number" &&
        typeof modelUsage.inputTokens === "number" &&
        typeof modelUsage.outputTokens === "number" &&
        typeof modelUsage.totalTokens === "number"))
  );
}
