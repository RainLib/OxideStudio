import { z } from "zod";

export const AGENT_HOST_PROTOCOL_VERSION = 1 as const;
export const AGENT_HOST_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const AGENT_HOST_EVENT_CHANNEL = "agent://event" as const;

export const agentProfileSchema = z.enum(["chat", "plan", "agent"]);
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const agentCapabilitySchema = z.enum([
  "chat",
  "plan",
  "agent",
  "model-proxy",
  "tool-proxy",
  "checkpoint-proxy",
  "artifact-proxy",
  "clarification",
  "approval",
  "subagents",
  "context-compaction",
]);
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const requestMetadataSchema = z.object({
  requestId: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  contextVersion: z.string().min(1),
  deadline: z.number().int().positive(),
});
export type RequestMetadata = z.infer<typeof requestMetadataSchema>;

export const initializeAgentHostParamsSchema = z.object({
  protocolVersion: z.literal(AGENT_HOST_PROTOCOL_VERSION),
  appVersion: z.string().min(1),
  maxFrameBytes: z.number().int().positive().max(AGENT_HOST_MAX_FRAME_BYTES),
  requiredCapabilities: z.array(agentCapabilitySchema),
});
export type InitializeAgentHostParams = z.infer<
  typeof initializeAgentHostParamsSchema
>;

export const initializeAgentHostResultSchema = z.object({
  protocolVersion: z.literal(AGENT_HOST_PROTOCOL_VERSION),
  runtime: z.literal("deepagents-typescript"),
  runtimeVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  capabilities: z.array(agentCapabilitySchema),
  maxFrameBytes: z.number().int().positive(),
});
export type InitializeAgentHostResult = z.infer<
  typeof initializeAgentHostResultSchema
>;

export const agentMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

export const providerCapabilitySchema = z.object({
  streaming: z.boolean(),
  toolCalling: z.boolean(),
  structuredOutput: z.boolean(),
  maxInputTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
});
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;

export const providerDescriptorSchema = z.object({
  model: z.string().min(1),
  capabilities: providerCapabilitySchema,
});
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;

export const jsonSchemaSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

export const agentToolManifestEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: jsonSchemaSchema,
  permissions: z.array(
    z.enum(["read", "write", "destructive", "external"]),
  ),
  timeoutMs: z.number().int().positive().optional(),
  resultLimit: z
    .object({
      maxRows: z.number().int().nonnegative().optional(),
      maxBytes: z.number().int().positive().optional(),
    })
    .optional(),
});
export type AgentToolManifestEntry = z.infer<
  typeof agentToolManifestEntrySchema
>;

export const workspaceContextSchema = z.object({
  projectId: z.string().min(1),
  connectionId: z.string().nullable(),
  database: z.string().nullable(),
  namespace: z.string().nullable(),
  activeTabId: z.string().nullable(),
  configRevision: z.string().nullable(),
  fingerprint: z.string().min(1),
  summary: z.record(z.string(), z.unknown()).default({}),
});
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

export const openThreadParamsSchema = requestMetadataSchema.extend({
  projectId: z.string().min(1),
  profile: agentProfileSchema,
});
export type OpenThreadParams = z.infer<typeof openThreadParamsSchema>;

export const startTurnParamsSchema = requestMetadataSchema.extend({
  projectId: z.string().min(1),
  profile: agentProfileSchema,
  messages: z.array(agentMessageSchema),
  prompt: z.string().min(1),
  provider: providerDescriptorSchema,
  workspace: workspaceContextSchema,
  tools: z.array(agentToolManifestEntrySchema),
  resumeCheckpoint: z.unknown().optional(),
});
export type StartTurnParams = z.infer<typeof startTurnParamsSchema>;

export const answerClarificationParamsSchema = requestMetadataSchema.extend({
  clarificationId: z.string().min(1),
  answers: z.record(z.string(), z.string()),
});
export type AnswerClarificationParams = z.infer<
  typeof answerClarificationParamsSchema
>;

export const resolveApprovalParamsSchema = requestMetadataSchema.extend({
  approvalId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  lease: z.string().nullable(),
});
export type ResolveApprovalParams = z.infer<
  typeof resolveApprovalParamsSchema
>;

export const cancelTurnParamsSchema = requestMetadataSchema.pick({
  requestId: true,
  threadId: true,
  turnId: true,
  contextVersion: true,
  deadline: true,
});
export type CancelTurnParams = z.infer<typeof cancelTurnParamsSchema>;

export const modelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(z.unknown())]),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.record(z.string(), z.unknown())).optional(),
});

export const modelRequestSchema = requestMetadataSchema.extend({
  messages: z.array(modelMessageSchema),
  tools: z.array(agentToolManifestEntrySchema),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type ModelRequest = z.infer<typeof modelRequestSchema>;

export const modelStreamRequestSchema = modelRequestSchema.extend({
  streamId: z.string().min(1),
});
export type ModelStreamRequest = z.infer<typeof modelStreamRequestSchema>;

export const modelResponseSchema = z.object({
  content: z.string(),
  model: z.string().nullable(),
  finishReason: z.string().nullable(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .nullable(),
  toolCalls: z.array(z.record(z.string(), z.unknown())),
});
export type ModelResponse = z.infer<typeof modelResponseSchema>;

export const modelStreamChunkSchema = requestMetadataSchema.extend({
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  delta: z.string(),
  toolCalls: z.array(z.record(z.string(), z.unknown())).default([]),
  finishReason: z.string().nullable().optional(),
  usage: modelResponseSchema.shape.usage.optional(),
  done: z.boolean().default(false),
});
export type ModelStreamChunk = z.infer<typeof modelStreamChunkSchema>;

export const toolInvokeRequestSchema = requestMetadataSchema.extend({
  callId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
  inputDigest: z.string().min(1),
  approvalLease: z.string().min(1).optional(),
});
export type ToolInvokeRequest = z.infer<typeof toolInvokeRequestSchema>;

export const boundedObservationSchema = z.object({
  summary: z.string(),
  data: z.unknown().optional(),
  rowCount: z.number().int().nonnegative().optional(),
  byteCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  artifactRef: z.string().nullable(),
});
export type BoundedObservation = z.infer<typeof boundedObservationSchema>;

export const checkpointRequestSchema = requestMetadataSchema.extend({
  projectId: z.string().min(1),
  checkpointVersion: z.number().int().positive(),
  checkpoint: z.unknown().optional(),
});
export type CheckpointRequest = z.infer<typeof checkpointRequestSchema>;

export const graphTypedBlobSchema = z.object({
  type: z.string().min(1).max(120),
  data: z.string(),
});
export type GraphTypedBlob = z.infer<typeof graphTypedBlobSchema>;

const graphCheckpointScopeSchema = requestMetadataSchema.extend({
  projectId: z.string().min(1),
  checkpointThreadId: z.string().min(1),
  checkpointNs: z.string().max(512).default(""),
});

export const graphCheckpointGetRequestSchema = graphCheckpointScopeSchema.extend({
  checkpointId: z.string().min(1).max(512).nullable(),
});
export type GraphCheckpointGetRequest = z.infer<
  typeof graphCheckpointGetRequestSchema
>;

export const graphCheckpointListRequestSchema = graphCheckpointScopeSchema.extend({
  checkpointId: z.string().min(1).max(512).nullable().optional(),
  beforeCheckpointId: z.string().min(1).max(512).nullable().optional(),
  limit: z.number().int().positive().max(1_000).default(100),
  filter: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type GraphCheckpointListRequest = z.infer<
  typeof graphCheckpointListRequestSchema
>;

export const graphCheckpointPutRequestSchema = graphCheckpointScopeSchema.extend({
  checkpointId: z.string().min(1).max(512),
  parentCheckpointId: z.string().min(1).max(512).nullable(),
  checkpoint: graphTypedBlobSchema,
  metadata: graphTypedBlobSchema,
});
export type GraphCheckpointPutRequest = z.infer<
  typeof graphCheckpointPutRequestSchema
>;

export const graphPendingWriteSchema = z.object({
  taskId: z.string().min(1).max(512),
  index: z.number().int(),
  channel: z.string().min(1).max(512),
  value: graphTypedBlobSchema,
});
export type GraphPendingWrite = z.infer<typeof graphPendingWriteSchema>;

export const graphCheckpointPutWritesRequestSchema =
  graphCheckpointScopeSchema.extend({
    checkpointId: z.string().min(1).max(512),
    writes: z.array(graphPendingWriteSchema).max(2_048),
  });
export type GraphCheckpointPutWritesRequest = z.infer<
  typeof graphCheckpointPutWritesRequestSchema
>;

export const graphCheckpointDeleteThreadRequestSchema =
  graphCheckpointScopeSchema.pick({
    requestId: true,
    threadId: true,
    turnId: true,
    contextVersion: true,
    deadline: true,
    projectId: true,
    checkpointThreadId: true,
  });
export type GraphCheckpointDeleteThreadRequest = z.infer<
  typeof graphCheckpointDeleteThreadRequestSchema
>;

export const graphCheckpointRecordSchema = z.object({
  checkpointThreadId: z.string().min(1),
  checkpointNs: z.string(),
  checkpointId: z.string().min(1),
  parentCheckpointId: z.string().nullable(),
  checkpoint: graphTypedBlobSchema,
  metadata: graphTypedBlobSchema,
  pendingWrites: z.array(graphPendingWriteSchema),
});
export type GraphCheckpointRecord = z.infer<
  typeof graphCheckpointRecordSchema
>;

export const resumeInterruptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clarification"),
    clarificationId: z.string().min(1),
    answers: z.record(z.string(), z.string()),
  }),
  z.object({
    kind: z.literal("approval"),
    approvalId: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
  }),
]);
export type ResumeInterrupt = z.infer<typeof resumeInterruptSchema>;

export const resumeTurnParamsSchema = startTurnParamsSchema.extend({
  resume: resumeInterruptSchema,
  transientApprovalLease: z
    .object({
      approvalId: z.string().min(1),
      lease: z.string().min(1),
    })
    .nullable()
    .optional(),
});
export type ResumeTurnParams = z.infer<typeof resumeTurnParamsSchema>;

export const clarificationQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .min(2)
    .max(3),
  allowFreeText: z.literal(true),
});
export type ClarificationQuestion = z.infer<
  typeof clarificationQuestionSchema
>;

const eventBaseSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.number().int().positive(),
});

export const agentEventSchema = z.discriminatedUnion("type", [
  eventBaseSchema.extend({
    type: z.literal("turn.status"),
    status: z.enum([
      "starting",
      "planning",
      "running",
      "awaiting_input",
      "awaiting_approval",
      "completed",
      "failed",
      "cancelled",
    ]),
    label: z.string().optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("plan.changed"),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.enum(["pending", "running", "completed", "failed"]),
      }),
    ),
  }),
  eventBaseSchema.extend({
    type: z.enum(["tool.started", "tool.finished"]),
    callId: z.string(),
    toolName: z.string(),
    label: z.string(),
    success: z.boolean().optional(),
    detail: z.string().optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("subagent"),
    name: z.string(),
    status: z.enum(["started", "completed", "failed"]),
    detail: z.string().optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("clarification"),
    clarificationId: z.string(),
    questions: z.array(clarificationQuestionSchema).min(1).max(3),
    context: z.string().optional(),
  }),
  eventBaseSchema.extend({
    type: z.literal("approval"),
    approvalId: z.string(),
    callId: z.string(),
    inputDigest: z.string(),
    toolName: z.string(),
    title: z.string(),
    risk: z.enum(["write", "destructive", "external"]),
    summary: z.string(),
  }),
  eventBaseSchema.extend({
    type: z.literal("context.compacted"),
    inputTokens: z.number().int().nonnegative(),
    retainedTokens: z.number().int().nonnegative(),
    offloadedArtifacts: z.number().int().nonnegative(),
  }),
  eventBaseSchema.extend({
    type: z.literal("answer.delta"),
    content: z.string(),
    reset: z.boolean().default(false),
  }),
  eventBaseSchema.extend({
    type: z.literal("final.answer"),
    content: z.string(),
    artifacts: z.array(z.string()).default([]),
  }),
  eventBaseSchema.extend({
    type: z.literal("failure"),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

export const jsonRpcIdSchema = z.union([z.string(), z.number()]);
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const jsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export const jsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: jsonRpcIdSchema,
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number().int(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcNotification = z.infer<typeof jsonRpcNotificationSchema>;
export type JsonRpcResponse = z.infer<typeof jsonRpcResponseSchema>;

export const HOST_METHODS = {
  initialize: "host.initialize",
  openThread: "thread.open",
  startTurn: "turn.start",
  resumeTurn: "turn.resume",
  cancelTurn: "turn.cancel",
  answerClarification: "turn.answerClarification",
  resolveApproval: "turn.resolveApproval",
} as const;

export const SIDECAR_METHODS = {
  modelComplete: "model.complete",
  modelStream: "model.stream",
  modelChunk: "model.chunk",
  toolInvoke: "tool.invoke",
  checkpointLoad: "checkpoint.load",
  checkpointSave: "checkpoint.save",
  graphCheckpointGet: "graph.checkpoint.get",
  graphCheckpointList: "graph.checkpoint.list",
  graphCheckpointPut: "graph.checkpoint.put",
  graphCheckpointPutWrites: "graph.checkpoint.putWrites",
  graphCheckpointDeleteThread: "graph.checkpoint.deleteThread",
  artifactRead: "artifact.read",
  event: "agent.event",
} as const;
