import { type AssistantTurn } from "@/ai/assistant/turns";
import {
  DEFAULT_TURN_TIMEOUT_MS,
  MAX_TURN_TIMEOUT_MS,
} from "@/features/assistant-session/model/sessionPolicy";
import { type AgentRequestMetadata } from "@/services/tauri/agent-host.service";

export function requestMetadata(
  turn: AssistantTurn,
  contextVersion: string,
  timeoutMs?: number,
): AgentRequestMetadata {
  if (!turn.threadId) {
    throw new Error("Agent turn has no thread identifier.");
  }
  return {
    requestId: createAgentId("request:command"),
    threadId: turn.threadId,
    turnId: turn.id,
    contextVersion: contextVersion || "context:unknown",
    deadline: commandDeadline(timeoutMs),
  };
}

export function commandDeadline(timeoutMs?: number) {
  const turnBudget = Math.max(
    DEFAULT_TURN_TIMEOUT_MS,
    Math.max(timeoutMs ?? 0, 30_000) * 20,
  );
  return Date.now() + Math.min(turnBudget, MAX_TURN_TIMEOUT_MS);
}

export function createAgentId(prefix: string) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${suffix}`;
}

export function conversationScope(projectId: string, conversationId?: string) {
  return `${projectId}\u0000${conversationId || "default"}`;
}
