import {
  assistantConversationBelongsToScope,
  assistantConversationScopeKey,
} from "@/features/assistant-panel/model/conversationIdentity";

const ACTIVE_CONVERSATION_STORAGE_KEY =
  "oxide-assistant-active-conversations-v1";

export function resolveStoredAssistantConversationId(
  projectId: string,
  conversationScope?: string,
) {
  if (!conversationScope) return "";
  if (typeof window === "undefined") return conversationScope;
  try {
    const value = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    const selections = value
      ? (JSON.parse(value) as Record<string, unknown>)
      : {};
    const candidate =
      selections[assistantConversationScopeKey(projectId, conversationScope)];
    return typeof candidate === "string" &&
      assistantConversationBelongsToScope(candidate, conversationScope)
      ? candidate
      : conversationScope;
  } catch {
    return conversationScope;
  }
}

export function persistAssistantConversationSelection(
  projectId: string,
  conversationScope: string,
  conversationId: string,
) {
  if (
    typeof window === "undefined" ||
    !assistantConversationBelongsToScope(conversationId, conversationScope)
  ) {
    return;
  }
  try {
    const value = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : {};
    const selections =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const scopeKey = assistantConversationScopeKey(
      projectId,
      conversationScope,
    );
    delete selections[scopeKey];
    selections[scopeKey] = conversationId;
    const boundedSelections = Object.fromEntries(
      Object.entries(selections).slice(-100),
    );
    window.localStorage.setItem(
      ACTIVE_CONVERSATION_STORAGE_KEY,
      JSON.stringify(boundedSelections),
    );
  } catch {
    // Persistence is a convenience. A denied/quota-limited localStorage must
    // never prevent starting or opening a conversation in this session.
  }
}
