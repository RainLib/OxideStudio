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
import type {
  AssistantContextCompactionStats,
  AssistantModelUsageStats,
} from "./turns";

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
  estimatedTokens: number;
  truncated: boolean;
  sample: string | null;
};

export type AssistantContextTokenBudget = {
  estimatedInputTokens: number;
  maxInputTokens: number | null;
  utilizationPercent: number | null;
  toolManifestTokens: number;
  promptCompactionThresholdTokens: number | null;
  promptCompactionLikely: boolean;
  pressure: "unknown" | "comfortable" | "approaching" | "compaction-likely";
};

export type AssistantContextOmission = {
  source: "editor" | "selection" | "history" | "tool-results";
  reason: "excluded" | "bounded";
  omittedCharacters: number | null;
  omittedMessages: number | null;
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
    estimatedTokens: number;
    omittedMessages: number;
    omittedCharacters: number;
    truncated: boolean;
  };
  tokenBudget: AssistantContextTokenBudget;
  previousCompaction: AssistantContextCompactionStats | null;
  previousModelUsage: AssistantModelUsageStats | null;
  omissions: AssistantContextOmission[];
  sendsToolManifest: boolean;
  toolManifestCount: number;
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
  maxInputTokens?: number | null;
  toolManifest?: readonly unknown[];
  previousCompaction?: AssistantContextCompactionStats | null;
  previousModelUsage?: AssistantModelUsageStats | null;
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
  const prompt = textPreview(
    input.message,
    true,
    // The Deep Agents runtime retains the complete prompt and performs its
    // own range-preserving compaction. Only legacy planners use the older
    // promptCharacters bound, so preview the payload that is actually sent.
    Number.MAX_SAFE_INTEGER,
  );
  const editor = textPreview(
    editorText,
    input.settings.includeEditorContent,
    resolvedMode === "chat"
      ? CHAT_CONTEXT_LIMITS.messageCharacters
      : MODEL_CONTEXT_TEXT_LIMIT,
  );
  const selection = textPreview(
    input.selectedText,
    input.settings.includeSelection,
    resolvedMode === "chat"
      ? CHAT_CONTEXT_LIMITS.messageCharacters
      : MODEL_CONTEXT_TEXT_LIMIT,
  );
  const historyTokens = estimateAssistantTokens(
    boundedHistory.map((entry) => entry.content).join("\n"),
  );
  const sendsToolManifest =
    destination === "provider" && resolvedMode !== "chat";
  const toolManifestCount = sendsToolManifest
    ? input.toolManifest?.length ?? 0
    : 0;
  const toolManifestTokens = sendsToolManifest
    ? estimateAssistantTokens(safeJson(input.toolManifest ?? []))
    : 0;
  const estimatedInputTokens =
    prompt.estimatedTokens +
    editor.estimatedTokens +
    selection.estimatedTokens +
    historyTokens +
    toolManifestTokens;
  const maxInputTokens = normalizeTokenLimit(input.maxInputTokens);
  const utilizationPercent =
    maxInputTokens === null
      ? null
      : Math.ceil((estimatedInputTokens / maxInputTokens) * 100);
  const promptCompactionThresholdTokens =
    maxInputTokens === null ? null : Math.floor(maxInputTokens * 0.55);
  const promptCompactionLikely =
    promptCompactionThresholdTokens !== null &&
    prompt.estimatedTokens > promptCompactionThresholdTokens;
  const omissions = contextOmissions({
    editor,
    selection,
    historyIncluded: input.settings.includeHistory,
    historyAvailableMessages: input.history.length,
    historyOmittedMessages: input.settings.includeHistory
      ? Math.max(0, input.history.length - boundedHistory.length)
      : input.history.length,
    historyOmittedCharacters: input.settings.includeHistory
      ? Math.max(0, originalHistoryCharacters - historyCharacters)
      : originalHistoryCharacters,
    canShareToolResults,
    sendsToolResults,
  });

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
    prompt,
    editor,
    selection,
    history: {
      availableMessages: input.history.length,
      included: input.settings.includeHistory,
      sentMessages: boundedHistory.length,
      sentCharacters: historyCharacters,
      estimatedTokens: historyTokens,
      omittedMessages: input.settings.includeHistory
        ? Math.max(0, input.history.length - boundedHistory.length)
        : input.history.length,
      omittedCharacters: input.settings.includeHistory
        ? Math.max(0, originalHistoryCharacters - historyCharacters)
        : originalHistoryCharacters,
      truncated:
        input.settings.includeHistory &&
        (boundedHistory.length < input.history.length ||
          historyCharacters < originalHistoryCharacters),
    },
    tokenBudget: {
      estimatedInputTokens,
      maxInputTokens,
      utilizationPercent,
      toolManifestTokens,
      promptCompactionThresholdTokens,
      promptCompactionLikely,
      pressure: contextPressure(utilizationPercent, promptCompactionLikely),
    },
    previousCompaction: input.previousCompaction ?? null,
    previousModelUsage: input.previousModelUsage ?? null,
    omissions,
    sendsToolManifest,
    toolManifestCount,
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
    estimatedTokens: estimateAssistantTokens(bounded),
    truncated: included && bounded.length < text.length,
    sample: bounded ? previewSample(bounded) : null,
  };
}

export function estimateAssistantTokens(value: string) {
  return value ? Math.ceil(value.length / 4) : 0;
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

function normalizeTokenLimit(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function contextPressure(
  utilizationPercent: number | null,
  promptCompactionLikely: boolean,
): AssistantContextTokenBudget["pressure"] {
  if (promptCompactionLikely || (utilizationPercent ?? 0) >= 85) {
    return "compaction-likely";
  }
  if ((utilizationPercent ?? 0) >= 70) return "approaching";
  return utilizationPercent === null ? "unknown" : "comfortable";
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function contextOmissions(input: {
  editor: AssistantContextTextPreview;
  selection: AssistantContextTextPreview;
  historyIncluded: boolean;
  historyAvailableMessages: number;
  historyOmittedMessages: number;
  historyOmittedCharacters: number;
  canShareToolResults: boolean;
  sendsToolResults: boolean;
}): AssistantContextOmission[] {
  const omissions: AssistantContextOmission[] = [];
  for (const [source, preview] of [
    ["editor", input.editor],
    ["selection", input.selection],
  ] as const) {
    if (!preview.available) continue;
    if (!preview.included) {
      omissions.push({
        source,
        reason: "excluded",
        omittedCharacters: preview.originalCharacters,
        omittedMessages: null,
      });
    } else if (preview.truncated) {
      omissions.push({
        source,
        reason: "bounded",
        omittedCharacters: Math.max(
          0,
          preview.originalCharacters - preview.sentCharacters,
        ),
        omittedMessages: null,
      });
    }
  }
  if (
    input.historyAvailableMessages > 0 &&
    (!input.historyIncluded ||
      input.historyOmittedMessages > 0 ||
      input.historyOmittedCharacters > 0)
  ) {
    omissions.push({
      source: "history",
      reason: input.historyIncluded ? "bounded" : "excluded",
      omittedCharacters: input.historyOmittedCharacters,
      omittedMessages: input.historyOmittedMessages,
    });
  }
  if (input.canShareToolResults && !input.sendsToolResults) {
    omissions.push({
      source: "tool-results",
      reason: "excluded",
      omittedCharacters: null,
      omittedMessages: null,
    });
  }
  return omissions;
}
