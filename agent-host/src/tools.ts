import { createHash, randomUUID } from "node:crypto";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import {
  SIDECAR_METHODS,
  artifactReadRequestSchema,
  artifactReadResultSchema,
  artifactSearchRequestSchema,
  artifactSearchResultSchema,
  boundedObservationSchema,
  clarificationOptionSchema,
  clarificationQuestionSchema,
  type AgentToolManifestEntry,
  type AnswerClarificationParams,
  type BoundedObservation,
  type ClarificationQuestion,
  type ResolveApprovalParams,
  type ToolInvokeRequest,
} from "@oxide/agent-contract";
import type { TurnExecution } from "./runtime.js";
import { AgentProtocolError } from "./rpc.js";

const askUserQuestionInputSchema = clarificationQuestionSchema
  .omit({
    allowFreeText: true,
    options: true,
  })
  .extend({
    // The model-facing boundary is intentionally wider than the UI contract.
    // Some OpenAI-compatible models occasionally ignore maxItems=3. The host
    // normalizes those calls instead of failing the entire turn.
    options: z.array(clarificationOptionSchema).min(2).max(8),
  });

export function createProxyTools(execution: TurnExecution) {
  return execution.params.tools
    .filter((manifest) => isToolAllowedForProfile(manifest, execution.params.profile))
    .map(
      (manifest) =>
        new DynamicStructuredTool({
          name: manifest.name,
          description: manifest.description,
          schema: manifest.inputSchema,
          func: async (input, _runManager, config) =>
            invokeProxyTool(
              execution,
              manifest,
              input,
              toolInvocationId(config),
            ),
        }),
    );
}

export function createAskUserTool(execution: TurnExecution) {
  return new DynamicStructuredTool({
    name: "ask_user",
    description:
      "Pause this turn and ask the user only when a material goal, scope, success criterion, connection, or safety constraint is ambiguous.",
    schema: z.object({
      // Whether free text is allowed is an OxideStudio UI policy, not a model
      // choice. Unknown legacy values are stripped by Zod and normalized below.
      questions: z.array(askUserQuestionInputSchema).min(1).max(6),
    }),
    func: async ({ questions }, _runManager, config) =>
      askUser(
        execution,
        normalizeClarificationQuestions(questions),
        toolInvocationId(config),
      ),
  });
}

export function createContextArtifactTools(execution: TurnExecution) {
  const readArtifact = new DynamicStructuredTool({
    name: "context_read_artifact",
    description:
      "Read one bounded UTF-8 JSON range from an encrypted artifactRef returned by a previous tool. Use offset 0 first, then continue with nextOffset until eof.",
    schema: z.object({
      artifactRef: z.string().min(1).max(240),
      offset: z.number().int().nonnegative().default(0),
      maxBytes: z.number().int().positive().max(64 * 1024).default(32 * 1024),
    }),
    func: async ({ artifactRef, offset, maxBytes }, _runManager, config) =>
      invokeContextArtifactTool(
        execution,
        "context_read_artifact",
        toolInvocationId(config),
        async () => {
          const request = artifactReadRequestSchema.parse({
            ...execution.metadataFor(`artifact-read:${artifactRef}:${offset}`),
            projectId: execution.params.projectId,
            artifactId: artifactRef,
            offset,
            maxBytes,
          });
          const result = artifactReadResultSchema.parse(
            await execution.peer.call<unknown>(
              SIDECAR_METHODS.artifactRead,
              request,
              execution.remainingMs(),
            ),
          );
          if (result.encoding === "base64-json" && result.content) {
            return {
              ...result,
              encoding: "utf8-json-fragment",
              content: Buffer.from(result.content, "base64url").toString("utf8"),
            };
          }
          return result;
        },
      ),
  });
  const searchArtifact = new DynamicStructuredTool({
    name: "context_search_artifact",
    description:
      "Search an encrypted artifactRef for a bounded set of JSON text matches before reading a specific range.",
    schema: z.object({
      artifactRef: z.string().min(1).max(240),
      query: z.string().trim().min(1).max(256),
      maxMatches: z.number().int().positive().max(20).default(8),
      contextBytes: z.number().int().min(16).max(512).default(120),
    }),
    func: async (
      { artifactRef, query, maxMatches, contextBytes },
      _runManager,
      config,
    ) =>
      invokeContextArtifactTool(
        execution,
        "context_search_artifact",
        toolInvocationId(config),
        async () => {
          const request = artifactSearchRequestSchema.parse({
            ...execution.metadataFor(`artifact-search:${artifactRef}`),
            projectId: execution.params.projectId,
            artifactId: artifactRef,
            query,
            maxMatches,
            contextBytes,
          });
          return artifactSearchResultSchema.parse(
            await execution.peer.call<unknown>(
              SIDECAR_METHODS.artifactSearch,
              request,
              execution.remainingMs(),
            ),
          );
        },
      ),
  });
  return [readArtifact, searchArtifact];
}

async function invokeContextArtifactTool(
  execution: TurnExecution,
  toolName: "context_read_artifact" | "context_search_artifact",
  invocationId: string | undefined,
  invoke: () => Promise<unknown>,
) {
  execution.throwIfCancelled();
  const callId = `${toolName}:${invocationId ?? randomUUID()}`;
  const label =
    toolName === "context_read_artifact"
      ? "Read offloaded context"
      : "Search offloaded context";
  await execution.emit({
    type: "tool.started",
    callId,
    toolName,
    label,
  });
  try {
    const result = await execution.withReadOnlyLimit(invoke);
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName,
      label,
      success: true,
      detail:
        toolName === "context_read_artifact"
          ? "Read a bounded artifact range."
          : "Searched an encrypted artifact.",
    });
    return JSON.stringify(result);
  } catch (error) {
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName,
      label,
      success: false,
      detail: safeErrorMessage(error),
    });
    throw error;
  }
}

function normalizeClarificationQuestions(
  questions: Array<z.infer<typeof askUserQuestionInputSchema>>,
): ClarificationQuestion[] {
  return questions.slice(0, 3).map((question) => {
    const uniqueOptions = question.options.filter(
      (option, index, options) =>
        options.findIndex((candidate) => candidate.id === option.id) === index,
    );
    const withoutRedundantFreeText = uniqueOptions.filter(
      (option) => !isRedundantFreeTextOption(option.id, option.label),
    );
    const candidates =
      withoutRedundantFreeText.length >= 2
        ? withoutRedundantFreeText
        : uniqueOptions;

    return clarificationQuestionSchema.parse({
      ...question,
      options: candidates.slice(0, 3),
      allowFreeText: true,
    });
  });
}

function isRedundantFreeTextOption(id: string, label: string): boolean {
  const normalizedId = id.trim().toLowerCase().replaceAll("-", "_");
  if (
    [
      "other",
      "others",
      "custom",
      "free_text",
      "freetext",
      "manual_input",
    ].includes(normalizedId)
  ) {
    return true;
  }

  const normalizedLabel = label.trim().toLowerCase();
  return (
    /^(?:其他|其它|自定义|手动输入)(?:$|[\s（(：:])/u.test(normalizedLabel) ||
    /^(?:other|others|something else|none of the above)(?:$|\b|\s|\()/u.test(
      normalizedLabel,
    )
  );
}

async function invokeProxyTool(
  execution: TurnExecution,
  manifest: AgentToolManifestEntry,
  input: unknown,
  invocationId?: string,
): Promise<string> {
  execution.throwIfCancelled();
  const inputDigest = canonicalInputDigest(input);
  const callId = stableToolCallId(
    execution,
    manifest.name,
    inputDigest,
    invocationId,
  );
  const label = processLabel(manifest.name);
  await execution.emit({
    type: "tool.started",
    callId,
    toolName: manifest.name,
    label,
  });

  let approvalLease: string | undefined;
  if (manifest.permissions.some((permission) => permission !== "read")) {
    const approvalResume = execution.matchingResume("approval");
    const approvalId =
      approvalResume
        ? approvalResume.approvalId
        : stableApprovalId(callId);
    const payload = {
      kind: "approval" as const,
      approvalId,
      decision: "reject" as const,
    };
    execution.markSuspended(
      payload,
      approvalResume
        ? null
        : {
            type: "approval",
            approvalId,
            callId,
            inputDigest,
            toolName: manifest.name,
            title: `Approve ${manifest.name}`,
            risk: approvalRisk(manifest),
            summary: `Allow this exact ${manifest.name} call once.`,
          },
    );
    const resumed = interrupt(payload);
    execution.clearSuspension();
    execution.markResumeConsumed();
    const decision = approvalResolution(resumed, approvalId);
    if (decision !== "approve") {
      await execution.emit({
        type: "tool.finished",
        callId,
        toolName: manifest.name,
        label,
        success: false,
        detail: "User rejected the action.",
      });
      throw new Error(`Action rejected: ${manifest.name}`);
    }
    approvalLease = execution.consumeApprovalLease(approvalId) ?? undefined;
    if (!approvalLease) {
      throw new Error(
        `Approval lease is unavailable after resume; ${manifest.name} was not executed.`,
      );
    }
  }

  const request: ToolInvokeRequest = {
    ...execution.metadataFor(`tool:${callId}`),
    callId,
    toolName: manifest.name,
    input,
    inputDigest,
    approvalLease,
  };
  try {
    const invoke = () =>
      execution.peer.call<unknown>(
        SIDECAR_METHODS.toolInvoke,
        request,
        execution.remainingMs(),
      );
    const raw = approvalLease
      ? await execution.withMutationLock(invoke)
      : await execution.withReadOnlyLimit(invoke);
    const observation = boundedObservationSchema.parse(raw);
    execution.recordArtifactReference(observation.artifactRef);
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName: manifest.name,
      label,
      success: true,
      detail: toolObservationDetail(observation),
    });
    return serializeObservation(observation);
  } catch (error) {
    const selection = connectionSelection(error);
    if (
      selection &&
      manifest.permissions.every((permission) => permission === "read")
    ) {
      const resolution = await askUser(
        execution,
        [
          {
            id: "connectionId",
            prompt: "Which database connection should I use?",
            options: selection.candidates.slice(0, 3).map((candidate) => ({
              id: candidate.id,
              label: candidate.name,
              description: candidate.driver,
            })),
            allowFreeText: true,
          },
        ],
        `${invocationId ?? callId}:connection-selection`,
      );
      const selectedConnectionId = selectedConnectionFromResolution(
        resolution,
        selection.candidates,
      );
      const resolvedInput = {
        ...(isRecord(input) ? input : {}),
        connectionId: selectedConnectionId,
      };
      const resolvedDigest = canonicalInputDigest(resolvedInput);
      const resolvedRequest: ToolInvokeRequest = {
        ...execution.metadataFor(`tool:${callId}:connection`),
        callId,
        toolName: manifest.name,
        input: resolvedInput,
        inputDigest: resolvedDigest,
      };
      const raw = await execution.withReadOnlyLimit(() =>
        execution.peer.call<unknown>(
          SIDECAR_METHODS.toolInvoke,
          resolvedRequest,
          execution.remainingMs(),
        ),
      );
      const observation = boundedObservationSchema.parse(raw);
      execution.recordArtifactReference(observation.artifactRef);
      await execution.emit({
        type: "tool.finished",
        callId,
        toolName: manifest.name,
        label,
        success: true,
        detail: toolObservationDetail(observation),
      });
      return serializeObservation(observation);
    }

    await execution.emit({
      type: "tool.finished",
      callId,
      toolName: manifest.name,
      label,
      success: false,
      detail: safeErrorMessage(error),
    });
    throw error;
  }
}

type ConnectionCandidate = {
  id: string;
  name: string;
  driver: string;
};

function connectionSelection(
  error: unknown,
): { candidates: ConnectionCandidate[] } | null {
  if (!(error instanceof AgentProtocolError) || !isRecord(error.data)) {
    return null;
  }
  if (
    error.data.kind !== "connection_selection_required" ||
    !Array.isArray(error.data.candidates)
  ) {
    return null;
  }
  const candidates = error.data.candidates.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !candidate.id.trim() ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim() ||
      typeof candidate.driver !== "string" ||
      !candidate.driver.trim()
    ) {
      return [];
    }
    return [
      {
        id: candidate.id.trim(),
        name: candidate.name.trim(),
        driver: candidate.driver.trim(),
      },
    ];
  });
  return candidates.length >= 2 ? { candidates } : null;
}

function selectedConnectionFromResolution(
  resolution: string,
  candidates: ConnectionCandidate[],
): string {
  let answer = "";
  try {
    const parsed = JSON.parse(resolution) as unknown;
    if (isRecord(parsed) && isRecord(parsed.answers)) {
      const value = parsed.answers.connectionId;
      if (typeof value === "string") answer = value.trim();
    }
  } catch {
    // askUser always returns JSON; the explicit error below is safer than
    // guessing if a stale checkpoint contains a malformed value.
  }
  const normalized = answer.toLowerCase();
  const matches = candidates.filter(
    (candidate) =>
      candidate.id === answer ||
      candidate.name.toLowerCase() === normalized ||
      candidate.driver.toLowerCase() === normalized,
  );
  if (matches.length !== 1) {
    throw new Error(
      "The selected database connection is invalid or ambiguous. Choose one listed connection.",
    );
  }
  return matches[0]!.id;
}

async function askUser(
  execution: TurnExecution,
  questions: ClarificationQuestion[],
  invocationId?: string,
): Promise<string> {
  execution.throwIfCancelled();
  if (execution.clarificationCount >= 2) {
    throw new Error("Clarification limit reached; make the safest reasonable assumption.");
  }
  execution.clarificationCount += 1;
  const clarificationResume = execution.matchingResume("clarification");
  const clarificationId =
    clarificationResume
      ? clarificationResume.clarificationId
      : stableClarificationId(execution, invocationId ?? randomUUID());
  const payload = {
    kind: "clarification" as const,
    clarificationId,
    answers: {} as Record<string, string>,
  };
  execution.markSuspended(
    payload,
    clarificationResume
      ? null
      : {
          type: "clarification",
          clarificationId,
          questions,
          context: "Your answer will resume this same turn.",
        },
  );
  const resumed = interrupt(payload);
  execution.clearSuspension();
  execution.markResumeConsumed();
  const answers = clarificationAnswers(resumed, clarificationId);
  return JSON.stringify({ answers });
}

function clarificationAnswers(
  value: unknown,
  clarificationId: string,
): Record<string, string> {
  if (
    !isRecord(value) ||
    value.kind !== "clarification" ||
    value.clarificationId !== clarificationId ||
    !isRecord(value.answers)
  ) {
    throw new Error("Clarification resume payload is invalid or stale.");
  }
  const answers = Object.fromEntries(
    Object.entries(value.answers).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  if (Object.keys(answers).length === 0) {
    throw new Error("Clarification resume payload has no answers.");
  }
  return answers;
}

function approvalResolution(
  value: unknown,
  approvalId: string,
): "approve" | "reject" {
  if (
    !isRecord(value) ||
    value.kind !== "approval" ||
    value.approvalId !== approvalId ||
    (value.decision !== "approve" && value.decision !== "reject")
  ) {
    throw new Error("Approval resume payload is invalid or stale.");
  }
  return value.decision;
}

function stableToolCallId(
  execution: TurnExecution,
  toolName: string,
  inputDigest: string,
  invocationId?: string,
): string {
  return `tool-${createHash("sha256")
    .update(execution.params.threadId)
    .update("\u0000")
    .update(execution.params.turnId)
    .update("\u0000")
    .update(toolName)
    .update("\u0000")
    .update(inputDigest)
    .update("\u0000")
    .update(invocationId ?? "unknown-invocation")
    .digest("base64url")}`;
}

function stableClarificationId(
  execution: TurnExecution,
  invocationId: string,
): string {
  return `clarification-${createHash("sha256")
    .update(execution.params.threadId)
    .update("\u0000")
    .update(execution.params.turnId)
    .update("\u0000")
    .update(invocationId)
    .digest("base64url")}`;
}

function toolInvocationId(config: unknown): string | undefined {
  if (!isRecord(config) || !isRecord(config.toolCall)) return undefined;
  return typeof config.toolCall.id === "string"
    ? config.toolCall.id
    : undefined;
}

function stableApprovalId(callId: string): string {
  return `approval-${createHash("sha256")
    .update(callId)
    .digest("base64url")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isToolAllowedForProfile(
  manifest: AgentToolManifestEntry,
  profile: "chat" | "plan" | "agent",
): boolean {
  if (profile === "chat") return false;
  if (profile === "plan") {
    return manifest.permissions.length > 0 && manifest.permissions.every((p) => p === "read");
  }
  return true;
}

function approvalRisk(
  manifest: AgentToolManifestEntry,
): "write" | "destructive" | "external" {
  if (manifest.permissions.includes("destructive")) return "destructive";
  if (manifest.permissions.includes("external")) return "external";
  return "write";
}

function processLabel(toolName: string): string {
  if (toolName.startsWith("metadata.")) return "Read schema";
  if (toolName.startsWith("query.")) return "Ran query analysis";
  if (toolName.startsWith("lsp.")) return "Read editor diagnostics";
  if (toolName.startsWith("editor.")) return "Prepared editor change";
  return toolName.replace(/[._-]+/gu, " ");
}

export function canonicalInputDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareUnicodeScalar(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function compareUnicodeScalar(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function serializeObservation(observation: BoundedObservation): string {
  return JSON.stringify({
    summary: observation.summary,
    data: observation.data,
    rowCount: observation.rowCount,
    truncated: observation.truncated,
    artifactRef: observation.artifactRef,
  });
}

export function toolObservationDetail(observation: BoundedObservation): string {
  const stats = [
    observation.rowCount === undefined
      ? null
      : `${observation.rowCount.toLocaleString("en-US")} rows`,
    `${observation.byteCount.toLocaleString("en-US")} bytes`,
    observation.truncated ? "truncated" : null,
  ].filter(Boolean);
  const summary = [observation.summary.trim(), stats.join(" · ")]
    .filter(Boolean)
    .join(" · ");
  if (observation.data === undefined) return summary.slice(0, 2_400);

  let serialized: string;
  try {
    serialized = JSON.stringify(observation.data, null, 2);
  } catch {
    return summary.slice(0, 2_400);
  }
  const preview = truncateVisibleOutput(serialized, 1_800);
  return `${summary}\nOutput preview\n${preview}`.slice(0, 2_400);
}

function truncateVisibleOutput(content: string, limit: number): string {
  const characters = Array.from(content);
  if (characters.length <= limit) return content;
  return `${characters.slice(0, Math.max(0, limit - 3)).join("").trimEnd()}...`;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Tool execution failed";
}

export type ClarificationResolution = Pick<
  AnswerClarificationParams,
  "answers"
>;
export type ApprovalResolution = Pick<
  ResolveApprovalParams,
  "decision" | "lease"
>;
