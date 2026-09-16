import { aiService } from "@/services/tauri/ai.service";
import type { AiSettingsState, AiSettingsValues } from "./contracts";
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
  DEFAULT_CODEX_CLI_PROFILE_ID,
} from "./defaults";
import { normalizedCliModel } from "./cliPreferences";

export const AI_SETTINGS_STORAGE_KEY = "oxide-ai-settings";
export const AI_SETTINGS_PERSIST_VERSION = 4;

type PersistedAiSettings = Partial<AiSettingsValues> & {
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
};

export function migratePersistedAiSettings(
  persisted: unknown,
  version: number,
): Partial<AiSettingsValues> {
  const state = (persisted || {}) as PersistedAiSettings;
  const assistantMode = state.assistantMode || "o2";
  const versionTwo =
    version >= 2
      ? state
      : {
          ...state,
          provider: state.provider || "openai-compatible",
          inlineBaseUrl:
            state.inlineBaseUrl || state.baseUrl || DEFAULT_AI_BASE_URL,
          inlineCompletionModel:
            state.inlineCompletionModel || state.model || DEFAULT_AI_MODEL,
          inlineTimeoutMs: state.inlineTimeoutMs || 4_000,
          codexCliProfileId: DEFAULT_CODEX_CLI_PROFILE_ID,
          codeBuddyCliProfileId: DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
        };
  const versionThree =
    version >= 3
      ? versionTwo
      : {
          ...versionTwo,
          codexCliAssistantMode: state.codexCliAssistantMode || assistantMode,
          codeBuddyCliAssistantMode:
            state.codeBuddyCliAssistantMode || assistantMode,
        };
  if (version >= 4) return versionThree;
  return {
    ...versionThree,
    codexCliReasoningEffortByModel: {
      ...(state.codexCliReasoningEffortByModel || {}),
      [normalizedCliModel(state.codexCliModel)]:
        state.codexCliReasoningEffort || "default",
    },
    codeBuddyCliReasoningEffortByModel: {
      ...(state.codeBuddyCliReasoningEffortByModel || {}),
      [normalizedCliModel(state.codeBuddyCliModel)]:
        state.codeBuddyCliReasoningEffort || "default",
    },
  };
}

export function persistedAiSettings(
  state: AiSettingsState,
): PersistedAiSettings {
  return {
    enabled: state.enabled,
    provider: state.provider,
    plannerKind: state.plannerKind,
    assistantMode: state.assistantMode,
    codexCliAssistantMode: state.codexCliAssistantMode,
    codeBuddyCliAssistantMode: state.codeBuddyCliAssistantMode,
    baseUrl: state.baseUrl,
    model: state.model,
    timeoutMs: state.timeoutMs,
    streaming: state.streaming,
    toolCalling: state.toolCalling,
    structuredOutput: state.structuredOutput,
    maxInputTokens: state.maxInputTokens,
    maxOutputTokens: state.maxOutputTokens,
    codexCliProfileId: state.codexCliProfileId,
    codexCliPath: state.codexCliPath,
    codexCliModel: state.codexCliModel,
    codexCliReasoningEffort: state.codexCliReasoningEffort,
    codexCliReasoningEffortByModel: state.codexCliReasoningEffortByModel,
    codexCliServiceTier: state.codexCliServiceTier,
    codexCliEnvironmentKeys: state.codexCliEnvironmentKeys,
    codeBuddyCliProfileId: state.codeBuddyCliProfileId,
    codeBuddyCliPath: state.codeBuddyCliPath,
    codeBuddyCliModel: state.codeBuddyCliModel,
    codeBuddyCliReasoningEffort: state.codeBuddyCliReasoningEffort,
    codeBuddyCliReasoningEffortByModel:
      state.codeBuddyCliReasoningEffortByModel,
    codeBuddyCliEnvironmentKeys: state.codeBuddyCliEnvironmentKeys,
    inlineBaseUrl: state.inlineBaseUrl,
    inlineTimeoutMs: state.inlineTimeoutMs,
    inlineCompletionProtocol: state.inlineCompletionProtocol,
    inlineCompletionModel: state.inlineCompletionModel,
  };
}

export function migrateLegacyAiSecrets(state: AiSettingsState | undefined) {
  if (!state) return;
  state.updateSettings({ codexCliAccessMode: "restricted" });
  const legacySecret = state.apiKey.trim();
  if (legacySecret) {
    void aiService
      .setProviderSecret(state.baseUrl, legacySecret)
      .then(() => state.updateSettings({ apiKey: "" }))
      .catch(() => undefined);
  }
  const legacyInlineSecret = state.inlineApiKey.trim();
  if (legacyInlineSecret) {
    void aiService
      .setProviderSecret(state.inlineBaseUrl, legacyInlineSecret, "inline")
      .then(() => state.updateSettings({ inlineApiKey: "" }))
      .catch(() => undefined);
  }
}
