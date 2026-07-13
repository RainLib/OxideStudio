import type { AssistantConversationMessage } from "./types";

export const CHAT_CONTEXT_LIMITS = {
  historyMessages: 12,
  historyCharacters: 24_000,
  messageCharacters: 6_000,
  promptCharacters: 12_000,
} as const;

export function boundedAssistantText(
  value: string | null | undefined,
  limit: number = CHAT_CONTEXT_LIMITS.messageCharacters
) {
  if (!value || value.length <= limit) return value;
  const suffix = "\n...[truncated]";
  if (limit <= suffix.length) return value.slice(0, limit);
  return `${value.slice(0, limit - suffix.length)}${suffix}`;
}

export function boundedConversationHistory(
  history: AssistantConversationMessage[] | undefined
): AssistantConversationMessage[] {
  if (!history?.length) return [];

  const recent = history.slice(-CHAT_CONTEXT_LIMITS.historyMessages);
  const result: AssistantConversationMessage[] = [];
  let remaining = CHAT_CONTEXT_LIMITS.historyCharacters;

  for (let index = recent.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const entry = recent[index]!;
    const limit = Math.min(CHAT_CONTEXT_LIMITS.messageCharacters, remaining);
    const content = boundedAssistantText(entry.content, limit) || "";
    result.unshift({ role: entry.role, content });
    remaining -= content.length;
  }

  return result;
}
