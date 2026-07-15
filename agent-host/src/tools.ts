import { createHash, randomUUID } from "node:crypto";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import {
  SIDECAR_METHODS,
  boundedObservationSchema,
  clarificationQuestionSchema,
  type AgentToolManifestEntry,
  type AnswerClarificationParams,
  type BoundedObservation,
  type ClarificationQuestion,
  type ResolveApprovalParams,
  type ToolInvokeRequest,
} from "@oxide/agent-contract";
import type { TurnExecution } from "./runtime.js";

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
      questions: z.array(clarificationQuestionSchema).min(1).max(3),
    }),
    func: async ({ questions }, _runManager, config) =>
      askUser(execution, questions, toolInvocationId(config)),
  });
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
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName: manifest.name,
      label,
      success: true,
      detail: observation.summary,
    });
    return serializeObservation(observation);
  } catch (error) {
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
