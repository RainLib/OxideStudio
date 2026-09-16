import type { AssistantMode } from "@/ai/assistant/modes";
import type { AiToolPermission, JsonSchema } from "@/ai/tools/types";
import type {
  AiCliProviderConfig,
  AiHttpProviderConfig,
} from "../ai.service";

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

export type AgentTurnRuntimeStatus = {
  active: boolean;
};

export type AgentTurnJournal = {
  projectId: string;
  threadId: string;
  turnId: string;
  events: AgentHostEvent[];
  truncated: boolean;
  updatedAt: number;
};

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

export type AgentConversationSummary = {
  projectId: string;
  conversationId: string;
  threadId: string;
  title: string;
  turnCount: number;
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
