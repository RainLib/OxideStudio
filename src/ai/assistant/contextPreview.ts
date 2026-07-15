import type { AiToolExecutionContext } from "@/ai/tools/types";
import {
  boundedAssistantText,
  boundedConversationHistory,
  CHAT_CONTEXT_LIMITS,
} from "./chatContext";
import {
  MODEL_CONTEXT_TEXT_LIMIT,
  MODEL_RESULT_COUNT_LIMIT,
  MODEL_RESULT_TOTAL_LIMIT,
} from "./modelPlanner";
import {
  resolveAssistantMode,
  type AssistantMode,
  type ResolvedAssistantMode,
} from "./modes";
import type {
  AssistantConversationMessage,
  AssistantTurnInput,
} from "./types";

export type AssistantContextSettings = {
  includeEditorContent: boolean;
  includeSelection: boolean;
  includeHistory: boolean;
  shareToolResults: boolean;
};

export const DEFAULT_ASSISTANT_CONTEXT_SETTINGS: AssistantContextSettings = {
  includeEditorContent: true,
  includeSelection: true,
  includeHistory: true,
  shareToolResults: true,
};

export type AssistantContextTextPreview = {
  available: boolean;
  included: boolean;
  originalCharacters: number;
  sentCharacters: number;
  truncated: boolean;
  sample: string | null;
};

export type AssistantContextPreview = {
  resolvedMode: ResolvedAssistantMode;
  destination: "provider" | "local" | "unavailable";
  destinationLabel: string;
  databaseIdentity: string;
  prompt: AssistantContextTextPreview;
  editor: AssistantContextTextPreview;
  selection: AssistantContextTextPreview;
  history: {
    availableMessages: number;
    included: boolean;
    sentMessages: number;
    sentCharacters: number;
    truncated: boolean;
  };
  sendsToolManifest: boolean;
  canShareToolResults: boolean;
  sendsToolResults: boolean;
  toolResultDetail: string;
};

type AssistantContextPreviewInput = {
  message: string;
  mode: AssistantMode;
  providerLabel: string | null;
  context: AiToolExecutionContext;
  selectedText: string | null;
  history: AssistantConversationMessage[];
  settings: AssistantContextSettings;
};

export function createAssistantContextPreview(
  input: AssistantContextPreviewInput,
): AssistantContextPreview {
  const resolvedMode = resolveAssistantMode(input.mode, input.message);
  const hasProvider = Boolean(input.providerLabel);
  const destination = hasProvider
    ? "provider"
    : resolvedMode === "chat"
      ? "unavailable"
      : "local";
  const boundedHistory = input.settings.includeHistory
    ? boundedConversationHistory(input.history)
    : [];
  const historyCharacters = boundedHistory.reduce(
    (total, entry) => total + entry.content.length,
    0,
  );
  const originalHistoryCharacters = input.history.reduce(
    (total, entry) => total + entry.content.length,
    0,
  );
  const editorText = input.context.activeTab?.sql ?? null;
  const canShareToolResults =
    destination === "provider" && resolvedMode === "agent";
  const sendsToolResults =
    canShareToolResults && input.settings.shareToolResults;

  return {
    resolvedMode,
    destination,
    destinationLabel:
      destination === "provider"
        ? input.providerLabel || "Configured provider"
        : destination === "local"
          ? "Local planner · nothing leaves this device"
          : "AI provider required · nothing will be sent",
    databaseIdentity: databaseIdentity(input.context),
    prompt: textPreview(
      input.message,
      true,
      CHAT_CONTEXT_LIMITS.promptCharacters,
    ),
    editor: textPreview(
      editorText,
      input.settings.includeEditorContent,
      resolvedMode === "chat"
        ? CHAT_CONTEXT_LIMITS.messageCharacters
        : MODEL_CONTEXT_TEXT_LIMIT,
    ),
    selection: textPreview(
      input.selectedText,
      input.settings.includeSelection,
      resolvedMode === "chat"
        ? CHAT_CONTEXT_LIMITS.messageCharacters
        : MODEL_CONTEXT_TEXT_LIMIT,
    ),
    history: {
      availableMessages: input.history.length,
      included: input.settings.includeHistory,
      sentMessages: boundedHistory.length,
      sentCharacters: historyCharacters,
      truncated:
        input.settings.includeHistory &&
        (boundedHistory.length < input.history.length ||
          historyCharacters < originalHistoryCharacters),
    },
    sendsToolManifest:
      destination === "provider" && resolvedMode !== "chat",
    canShareToolResults,
    sendsToolResults,
    toolResultDetail:
      resolvedMode === "chat"
        ? "Chat does not run tools"
        : resolvedMode === "plan"
          ? "Plan creates steps but does not execute tools"
          : destination !== "provider"
            ? "No model summarizer; tool outputs stay local"
            : sendsToolResults
              ? `After execution: up to ${MODEL_RESULT_COUNT_LIMIT} results and ${MODEL_RESULT_TOTAL_LIMIT.toLocaleString()} characters`
              : "Tool outputs stay local; only local counts and errors are summarized",
  };
}

export function applyAssistantContextSettings(
  context: AiToolExecutionContext,
  settings: AssistantContextSettings,
): AiToolExecutionContext {
  if (!context.activeTab) return context;
  return {
    ...context,
    activeTab: {
      ...context.activeTab,
      sql: settings.includeEditorContent
        ? context.activeTab.sql
        : undefined,
      selection: settings.includeSelection
        ? context.activeTab.selection
        : null,
    },
  };
}

export function createAssistantTurnInput(
  message: string,
  mode: AssistantMode,
  selectedText: string | null,
  history: AssistantConversationMessage[],
  settings: AssistantContextSettings,
): AssistantTurnInput {
  return {
    message,
    mode,
    selectedText: settings.includeSelection ? selectedText : null,
    history: settings.includeHistory ? history : [],
  };
}

function textPreview(
  value: string | null | undefined,
  included: boolean,
  limit: number,
): AssistantContextTextPreview {
  const text = value || "";
  const bounded = included ? boundedAssistantText(text, limit) || "" : "";
  return {
    available: Boolean(text),
    included,
    originalCharacters: text.length,
    sentCharacters: bounded.length,
    truncated: included && bounded.length < text.length,
    sample: bounded ? previewSample(bounded) : null,
  };
}

function previewSample(value: string) {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 177)}...`;
}

function databaseIdentity(context: AiToolExecutionContext) {
  const parts = [
    context.activeDriver,
    context.activeConnectionId,
    context.activeTab?.databaseName,
    context.activeNamespace,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "No active data source";
}
