import { type ModelUsage } from "./events.js";
import { isRecord } from "./value.js";

export function decodeStreamFrame(frame: unknown): {
  mode: "values" | "messages" | "unknown";
  value: unknown;
} {
  if (
    Array.isArray(frame) &&
    frame.length === 2 &&
    (frame[0] === "values" || frame[0] === "messages")
  ) {
    return { mode: frame[0], value: frame[1] };
  }
  return { mode: "values", value: frame };
}

export function decodeMessageFrame(value: unknown): {
  message: Record<string, unknown>;
  metadata: Record<string, unknown>;
} | null {
  if (!Array.isArray(value) || value.length < 1 || !isRecord(value[0])) {
    return null;
  }
  return {
    message: value[0],
    metadata: isRecord(value[1]) ? value[1] : {},
  };
}

export function isCoordinatorMessage(
  metadata: Record<string, unknown>,
): boolean {
  const namespace = metadata.langgraph_checkpoint_ns;
  if (typeof namespace === "string" && namespace.trim()) return false;
  const node = metadata.langgraph_node;
  return node === undefined || node === "model" || node === "agent";
}

export function messageIdentifier(message: Record<string, unknown>): string {
  return typeof message.id === "string" && message.id
    ? message.id
    : "coordinator-message";
}

export function modelUsage(
  message: Record<string, unknown>,
): ModelUsage | null {
  if (!isRecord(message.usage_metadata)) return null;
  const inputTokens = nonnegativeInteger(
    message.usage_metadata.input_tokens ?? message.usage_metadata.inputTokens,
  );
  const outputTokens = nonnegativeInteger(
    message.usage_metadata.output_tokens ?? message.usage_metadata.outputTokens,
  );
  const totalTokens = nonnegativeInteger(
    message.usage_metadata.total_tokens ?? message.usage_metadata.totalTokens,
  );
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

export function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function messageHasToolCallChunk(
  message: Record<string, unknown>,
): boolean {
  return [message.tool_call_chunks, message.tool_calls].some(
    (value) => Array.isArray(value) && value.length > 0,
  );
}

export function isSummarizationMessage(
  message: Record<string, unknown>,
): boolean {
  const metadata = isRecord(message.response_metadata)
    ? message.response_metadata
    : {};
  return (
    metadata.lcSource === "summarization" ||
    metadata.lc_source === "summarization"
  );
}

export function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((block) =>
      isRecord(block) && typeof block.text === "string" ? [block.text] : [],
    )
    .join("");
}
