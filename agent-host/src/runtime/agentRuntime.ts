import { Command } from "@langchain/langgraph";
import {
  AGENT_HOST_MAX_FRAME_BYTES,
  AGENT_HOST_PROTOCOL_VERSION,
  HOST_METHODS,
  answerClarificationParamsSchema,
  cancelTurnParamsSchema,
  initializeAgentHostParamsSchema,
  openThreadParamsSchema,
  resolveApprovalParamsSchema,
  resumeTurnParamsSchema,
  startTurnParamsSchema,
  type AgentCitation,
  type InitializeAgentHostResult,
  type RequestMetadata,
  type ResumeInterrupt,
  type StartTurnParams,
} from "@oxide/agent-contract";
import { StateBackend, createDeepAgent } from "deepagents/node";
import { OxideCheckpointSaver } from "../checkpointer.js";
import { OxideChatModel } from "../model.js";
import { AgentProtocolError, type JsonRpcPeer } from "../rpc.js";
import { createContextArtifactTools } from "../tools/artifacts.js";
import { createAskUserTool } from "../tools/clarification.js";
import { createProxyTools } from "../tools/proxy.js";
import { isRetryable, safeErrorMessage } from "./cancellation.js";
import { RUNTIME_VERSION, supportedCapabilities } from "./capabilities.js";
import {
  checkpointMessages,
  loadCheckpointMessages,
  memoryThreadId,
  saveCheckpoint,
} from "./checkpoints.js";
import { bestEffortEmit, emitCompaction, emitTodoPlan } from "./events.js";
import { TurnExecution } from "./execution.js";
import {
  decodeMessageFrame,
  decodeStreamFrame,
  isCoordinatorMessage,
  isSummarizationMessage,
  messageHasToolCallChunk,
  messageIdentifier,
  messageText,
} from "./messages.js";
import { createSubagents, systemPrompt } from "./profiles.js";
import { preparePromptForModel } from "./promptCompaction.js";
import {
  artifactReferencesInResult,
  citationEvidenceInResult,
  finalAnswer,
  resolveCitedAnswer,
} from "./result.js";

export class AgentRuntime {
  private initialized = false;
  private readonly turns = new Map<string, TurnExecution>();
  private readonly threads = new Map<string, { projectId: string }>();
  private readonly suspendedTurns = new Map<
    string,
    { params: StartTurnParams; artifacts: string[]; citations: AgentCitation[] }
  >();

  constructor(private readonly peer: JsonRpcPeer) {
    peer.register(HOST_METHODS.initialize, (params) => this.initialize(params));
    peer.register(HOST_METHODS.openThread, (params) => this.openThread(params));
    peer.register(HOST_METHODS.startTurn, (params) => this.startTurn(params));
    peer.register(HOST_METHODS.resumeTurn, (params) => this.resumeTurn(params));
    peer.register(HOST_METHODS.cancelTurn, (params) => this.cancelTurn(params));
    peer.register(HOST_METHODS.answerClarification, (params) =>
      this.answerClarification(params),
    );
    peer.register(HOST_METHODS.resolveApproval, (params) =>
      this.resolveApproval(params),
    );
  }

  cancelAll(): void {
    for (const turn of this.turns.values()) turn.cancel("shutdown");
  }

  private initialize(params: unknown): InitializeAgentHostResult {
    const request = initializeAgentHostParamsSchema.parse(params);
    const supported = supportedCapabilities();
    const missing = request.requiredCapabilities.filter(
      (capability) => !supported.includes(capability),
    );
    if (missing.length > 0) {
      throw new AgentProtocolError(
        "CAPABILITY_MISMATCH",
        `Missing required capabilities: ${missing.join(", ")}`,
      );
    }
    this.initialized = true;
    return {
      protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
      runtime: "deepagents-typescript",
      runtimeVersion: RUNTIME_VERSION,
      nodeVersion: process.version,
      capabilities: supported,
      maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
    };
  }

  private openThread(params: unknown): { opened: true } {
    this.assertInitialized();
    const request = openThreadParamsSchema.parse(params);
    const existing = this.threads.get(request.threadId);
    if (existing && existing.projectId !== request.projectId) {
      throw new AgentProtocolError("THREAD_PROJECT_MISMATCH");
    }
    this.threads.set(request.threadId, { projectId: request.projectId });
    return { opened: true };
  }

  private startTurn(params: unknown): { accepted: true } {
    this.assertInitialized();
    const request = startTurnParamsSchema.parse(params);
    return this.startExecution(request, null, null, [], []);
  }

  private resumeTurn(params: unknown): { accepted: true; resumed: true } {
    this.assertInitialized();
    const parsed = resumeTurnParamsSchema.safeParse(params);
    if (!parsed.success) {
      this.startExecution(
        startTurnParamsSchema.parse(params),
        null,
        null,
        [],
        [],
      );
      return { accepted: true, resumed: true };
    }
    const request = parsed.data;
    this.startExecution(
      request,
      request.resume,
      request.transientApprovalLease,
      [],
      [],
    );
    return { accepted: true, resumed: true };
  }

  private startExecution(
    request: StartTurnParams,
    resume: ResumeInterrupt | null,
    transientApprovalLease:
      | { approvalId: string; lease: string }
      | null
      | undefined,
    initialArtifactReferences: readonly string[],
    initialCitations: readonly AgentCitation[],
  ): { accepted: true } {
    if (request.workspace.projectId !== request.projectId) {
      throw new AgentProtocolError("WORKSPACE_PROJECT_MISMATCH");
    }
    if (
      request.profile !== "chat" &&
      !request.provider.capabilities.toolCalling
    ) {
      throw new AgentProtocolError("MODEL_TOOL_CALLING_UNSUPPORTED");
    }
    const existingThread = this.threads.get(request.threadId);
    if (existingThread && existingThread.projectId !== request.projectId) {
      throw new AgentProtocolError("THREAD_PROJECT_MISMATCH");
    }
    this.threads.set(request.threadId, { projectId: request.projectId });
    const key = turnKey(request.threadId, request.turnId);
    if (this.turns.has(key)) {
      throw new AgentProtocolError("TURN_ALREADY_RUNNING");
    }
    const execution = new TurnExecution(
      this.peer,
      request,
      resume,
      transientApprovalLease,
      initialArtifactReferences,
      initialCitations,
    );
    this.suspendedTurns.delete(key);
    this.turns.set(key, execution);
    execution.task = this.runTurn(execution).finally(() => {
      this.turns.delete(key);
    });
    return { accepted: true };
  }

  private cancelTurn(params: unknown): { cancelled: boolean } {
    const request = cancelTurnParamsSchema.parse(params);
    const key = turnKey(request.threadId, request.turnId);
    const execution = this.turns.get(key);
    const suspended = this.suspendedTurns.delete(key);
    execution?.cancel();
    return { cancelled: Boolean(execution || suspended) };
  }

  private answerClarification(params: unknown): { resumed: boolean } {
    const request = answerClarificationParamsSchema.parse(params);
    const key = turnKey(request.threadId, request.turnId);
    const suspended = this.suspendedTurns.get(key);
    if (!suspended) return { resumed: false };
    this.startExecution(
      withResumeMetadata(suspended.params, request),
      {
        kind: "clarification",
        clarificationId: request.clarificationId,
        answers: request.answers,
      },
      null,
      suspended.artifacts,
      suspended.citations,
    );
    return { resumed: true };
  }

  private resolveApproval(params: unknown): { resumed: boolean } {
    const request = resolveApprovalParamsSchema.parse(params);
    const key = turnKey(request.threadId, request.turnId);
    const suspended = this.suspendedTurns.get(key);
    if (!suspended) return { resumed: false };
    this.startExecution(
      withResumeMetadata(suspended.params, request),
      {
        kind: "approval",
        approvalId: request.approvalId,
        decision: request.decision,
      },
      request.lease
        ? { approvalId: request.approvalId, lease: request.lease }
        : null,
      suspended.artifacts,
      suspended.citations,
    );
    return { resumed: true };
  }

  private async runTurn(execution: TurnExecution): Promise<void> {
    const deadlineTimer = setTimeout(
      () => execution.cancel("deadline"),
      execution.remainingMs(),
    );
    deadlineTimer.unref?.();
    try {
      await execution.emit({
        type: "turn.status",
        status: "starting",
        label: "Starting AI runtime…",
      });
      const model = new OxideChatModel(
        this.peer,
        execution.metadataFor("model"),
        execution.params.provider.model,
        {
          maxInputTokens:
            execution.params.provider.capabilities.maxInputTokens ?? undefined,
          maxOutputTokens:
            execution.params.provider.capabilities.maxOutputTokens ?? undefined,
          toolCalling: execution.params.provider.capabilities.toolCalling,
          structuredOutput:
            execution.params.provider.capabilities.structuredOutput,
          streaming: execution.params.provider.capabilities.streaming,
        },
        [],
        `oxide-${execution.params.profile}`,
      );
      const proxyTools = createProxyTools(execution);
      const askUser = createAskUserTool(execution);
      const contextArtifactTools = createContextArtifactTools(execution);
      const readOnlyTools = proxyTools.filter((tool) => {
        const manifest = execution.params.tools.find(
          (candidate) => candidate.name === tool.name,
        );
        return manifest?.permissions.every(
          (permission) => permission === "read",
        );
      });
      const subagents = createSubagents(
        execution.params.profile,
        model,
        readOnlyTools,
      );
      const checkpointer = new OxideCheckpointSaver(execution);
      const agent = createDeepAgent({
        name: `oxide-${execution.params.profile}`,
        model,
        tools: [...proxyTools, ...contextArtifactTools, askUser],
        systemPrompt: systemPrompt(execution.params.profile),
        backend: new StateBackend(),
        checkpointer,
        subagents,
        permissions: [
          { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
        ],
      });
      await execution.emit({
        type: "turn.status",
        status: execution.params.profile === "chat" ? "running" : "planning",
      });
      const checkpointThreadId = memoryThreadId(execution.params);
      const graphConfig = {
        configurable: { thread_id: checkpointThreadId },
        recursionLimit: 80,
        signal: execution.controller.signal,
        streamMode: ["values", "messages"] as Array<"values" | "messages">,
      };
      const graphInput = execution.resume
        ? new Command({ resume: execution.resume })
        : {
            messages: [
              ...(await this.bootstrapMessages(
                execution,
                checkpointer,
                graphConfig,
              )),
              {
                role: "user",
                content: await preparePromptForModel(execution, model),
              },
            ],
          };
      const stream = await agent.stream(graphInput, graphConfig);
      let result: unknown;
      let streamedMessageId: string | null = null;
      let streamedToolCall = false;
      for await (const frame of stream as AsyncIterable<unknown>) {
        execution.throwIfCancelled();
        const decoded = decodeStreamFrame(frame);
        if (decoded.mode === "values") {
          result = decoded.value;
          continue;
        }
        if (decoded.mode !== "messages") continue;
        const messageFrame = decodeMessageFrame(decoded.value);
        if (!messageFrame) {
          continue;
        }
        execution.observeModelUsage(
          messageFrame.message,
          messageFrame.metadata,
        );
        if (!isCoordinatorMessage(messageFrame.metadata)) {
          continue;
        }
        const messageId = messageIdentifier(messageFrame.message);
        if (messageId !== streamedMessageId) {
          streamedMessageId = messageId;
          streamedToolCall = false;
          await execution.emit({
            type: "answer.delta",
            content: "",
            reset: true,
          });
        }
        if (messageHasToolCallChunk(messageFrame.message)) {
          if (!streamedToolCall) {
            streamedToolCall = true;
            const phaseDescription = messageText(messageFrame.message);
            if (phaseDescription) {
              await execution.emit({
                type: "answer.delta",
                content: phaseDescription,
                reset: false,
              });
            }
            await execution.emit({
              type: "answer.delta",
              content: "",
              reset: true,
            });
          }
          continue;
        }
        if (streamedToolCall || isSummarizationMessage(messageFrame.message)) {
          continue;
        }
        const delta = messageText(messageFrame.message);
        if (delta) {
          await execution.emit({
            type: "answer.delta",
            content: delta,
            reset: false,
          });
        }
      }
      if (execution.suspension) {
        await execution.emitModelUsage();
        this.suspendedTurns.set(
          turnKey(execution.params.threadId, execution.params.turnId),
          {
            params: execution.params,
            artifacts: execution.artifacts(),
            citations: execution.citations(),
          },
        );
        if (execution.suspensionEvent) {
          await execution.emit(execution.suspensionEvent);
        }
        await execution.emit({
          type: "turn.status",
          status:
            execution.suspension.kind === "approval"
              ? "awaiting_approval"
              : "awaiting_input",
        });
        return;
      }
      if (result === undefined) {
        throw new AgentProtocolError("AGENT_STREAM_RESULT_MISSING");
      }
      execution.throwIfCancelled();
      await emitTodoPlan(execution, result);
      await emitCompaction(execution, result);
      await execution.emitModelUsage();
      for (const citation of citationEvidenceInResult(result)) {
        execution.recordCitations([citation]);
      }
      const answer = finalAnswer(result);
      const citedAnswer = resolveCitedAnswer(answer, execution.citations());
      for (const artifactRef of artifactReferencesInResult(result)) {
        execution.recordArtifactReference(artifactRef);
      }
      await saveCheckpoint(execution, result);
      await execution.emit({
        type: "final.answer",
        content: citedAnswer.content,
        artifacts: execution.artifacts(),
        citations: citedAnswer.citations,
      });
      await execution.emit({ type: "turn.status", status: "completed" });
      this.suspendedTurns.delete(
        turnKey(execution.params.threadId, execution.params.turnId),
      );
    } catch (error) {
      await execution.emitModelUsage().catch(() => undefined);
      const cancelled = execution.controller.signal.aborted;
      if (cancelled) {
        await bestEffortEmit(execution, {
          type: "turn.status",
          status: "cancelled",
        });
      } else {
        await bestEffortEmit(execution, {
          type: "failure",
          code:
            error instanceof AgentProtocolError
              ? error.code
              : "AGENT_TURN_FAILED",
          message: safeErrorMessage(error),
          retryable: isRetryable(error),
        });
        await bestEffortEmit(execution, {
          type: "turn.status",
          status: "failed",
        });
      }
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new AgentProtocolError("HOST_NOT_INITIALIZED");
  }

  private async bootstrapMessages(
    execution: TurnExecution,
    checkpointer: OxideCheckpointSaver,
    graphConfig: { configurable: { thread_id: string } },
  ): Promise<Array<{ role: string; content: string }>> {
    if (await checkpointer.getTuple(graphConfig)) return [];

    const supplied = checkpointMessages(execution.params.resumeCheckpoint);
    if (supplied.length > 0) return supplied;

    const stored = await loadCheckpointMessages(execution).catch(() => []);
    if (stored.length > 0) return stored;
    return execution.params.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }
}

export function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`;
}

export function withResumeMetadata(
  params: StartTurnParams,
  metadata: RequestMetadata,
): StartTurnParams {
  return {
    ...params,
    requestId: metadata.requestId,
    threadId: metadata.threadId,
    turnId: metadata.turnId,
    contextVersion: metadata.contextVersion,
    deadline: metadata.deadline,
  };
}
