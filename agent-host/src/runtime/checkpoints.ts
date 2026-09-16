import { SIDECAR_METHODS, type StartTurnParams } from "@oxide/agent-contract";
import { createHash } from "node:crypto";
import { TurnExecution } from "./execution.js";
import { isSummarizationMessage, messageText } from "./messages.js";
import { isRecord } from "./value.js";

export async function saveCheckpoint(
  execution: TurnExecution,
  result: unknown,
): Promise<void> {
  const checkpoint = sanitizeCheckpoint(result);
  await execution.peer.call(
    SIDECAR_METHODS.checkpointSave,
    {
      ...execution.metadataFor("checkpoint"),
      projectId: execution.params.projectId,
      checkpointVersion: 1,
      checkpoint,
    },
    Math.min(5_000, execution.remainingMs()),
  );
}

export function sanitizeCheckpoint(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) return {};
  const messages = Array.isArray(result.messages)
    ? result.messages.slice(-64).flatMap((message) => {
        if (!isRecord(message)) return [];
        const role = checkpointRole(message);
        const content = messageText(message).trim();
        if (!role || !content) return [];
        return [
          {
            role,
            content: content.slice(0, 24_000),
            summary: isSummarizationMessage(message),
          },
        ];
      })
    : [];
  return {
    messages,
    todos: Array.isArray(result.todos) ? result.todos.slice(0, 100) : [],
    savedAt: Date.now(),
  };
}

export function checkpointRole(
  message: Record<string, unknown>,
): "user" | "assistant" | null {
  let raw =
    typeof message.role === "string"
      ? message.role
      : typeof message.type === "string"
        ? message.type
        : "";
  if (!raw && typeof message._getType === "function") {
    try {
      const value = (message._getType as () => unknown)();
      if (typeof value === "string") raw = value;
    } catch {
      return null;
    }
  }
  return normalizeCheckpointRole(raw);
}

export function memoryThreadId(params: StartTurnParams): string {
  return `oxide-${createHash("sha256")
    .update(params.projectId)
    .update("\u0000")
    .update(params.profile)
    .update("\u0000")
    .update(params.threadId)
    .digest("base64url")}`;
}

export async function loadCheckpointMessages(
  execution: TurnExecution,
): Promise<Array<{ role: string; content: string }>> {
  const response = await execution.peer.call(
    SIDECAR_METHODS.checkpointLoad,
    {
      ...execution.metadataFor("checkpoint-load"),
      projectId: execution.params.projectId,
      checkpointVersion: 1,
    },
    Math.min(5_000, execution.remainingMs()),
  );
  if (!isRecord(response)) return [];
  return checkpointMessages(response.checkpoint);
}

export function checkpointMessages(
  checkpoint: unknown,
): Array<{ role: string; content: string }> {
  if (!isRecord(checkpoint) || !Array.isArray(checkpoint.messages)) return [];
  return checkpoint.messages.slice(-24).flatMap((message) => {
    if (!isRecord(message) || typeof message.content !== "string") return [];
    const rawRole =
      typeof message.role === "string"
        ? message.role
        : typeof message.type === "string"
          ? message.type
          : "";
    const role = normalizeCheckpointRole(rawRole);
    if (!role || !message.content.trim()) return [];
    return [{ role, content: message.content.slice(0, 16_000) }];
  });
}

export function normalizeCheckpointRole(
  role: string,
): "user" | "assistant" | null {
  if (role === "human" || role === "user") return "user";
  if (role === "ai" || role === "assistant") return "assistant";
  return null;
}
