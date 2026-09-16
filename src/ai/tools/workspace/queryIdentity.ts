import type { AiToolExecutionContext } from "@/ai/tools/types";

export function createCancellableAiQueryId(
  context: AiToolExecutionContext,
  operation: string,
) {
  if (!context.abortSignal) return undefined;
  return [
    sanitizeQueryIdSegment(context.requestId),
    sanitizeQueryIdSegment(operation),
    createRequestId(),
  ].join(":");
}

export function sanitizeQueryIdSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-") || "ai";
}

export function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-tool-${Date.now()}`;
}
