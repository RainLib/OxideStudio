import { createHash } from "node:crypto";
import type { TurnExecution } from "../runtime/execution.js";
import { isRecord } from "./value.js";

export function stableToolCallId(
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

export function stableClarificationId(
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

export function toolInvocationId(config: unknown): string | undefined {
  if (!isRecord(config) || !isRecord(config.toolCall)) return undefined;
  return typeof config.toolCall.id === "string"
    ? config.toolCall.id
    : undefined;
}

export function stableApprovalId(callId: string): string {
  return `approval-${createHash("sha256").update(callId).digest("base64url")}`;
}

export function canonicalInputDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareUnicodeScalar(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function compareUnicodeScalar(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
