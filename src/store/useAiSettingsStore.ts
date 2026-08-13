import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  AiCliProviderConfig,
  AiCliReasoningEffort,
  AiHttpProviderConfig,
  AiProviderConfig,
  AiProviderKind,
} from "@/services/tauri/ai.service";
import type { AssistantMode } from "@/ai/assistant/modes";
import { aiService } from "@/services/tauri/ai.service";

export type { AiProviderKind } from "@/services/tauri/ai.service";
export type AiPlannerKind = "model" | "langgraph" | "local";
export type InlineCompletionProtocol =
  | "chat-completions"
  | "text-completions-fim";

export type AiCliReasoningPreferences = Record<string, AiCliReasoningEffort>;

export interface AiSettingsState {
  enabled: boolean;
  provider: AiProviderKind;
  plannerKind: AiPlannerKind;
  assistantMode: AssistantMode;
  codexCliAssistantMode: AssistantMode;
  codeBuddyCliAssistantMode: AssistantMode;

  // OpenAI-compatible Assistant profile. It remains intact when a CLI provider
  // is selected so switching providers never destroys a working configuration.
  baseUrl: string;
  model: string;
  apiKey: string;

  codexCliProfileId: string;
  codexCliPath: string;
  codexCliModel: string;
  codexCliReasoningEffort: AiCliReasoningEffort;
  codexCliReasoningEffortByModel: AiCliReasoningPreferences;
  codexCliEnvironmentKeys: string[];
  codexCliEnvironmentDraft: Record<string, string>;

  codeBuddyCliProfileId: string;
  codeBuddyCliPath: string;
  codeBuddyCliModel: string;
  codeBuddyCliReasoningEffort: AiCliReasoningEffort;
  codeBuddyCliReasoningEffortByModel: AiCliReasoningPreferences;
  codeBuddyCliEnvironmentKeys: string[];
  codeBuddyCliEnvironmentDraft: Record<string, string>;

  timeoutMs: number;
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;

  // Inline completion deliberately has a separate low-latency HTTP profile.
  inlineBaseUrl: string;
  inlineApiKey: string;
  inlineTimeoutMs: number;
  inlineCompletionProtocol: InlineCompletionProtocol;
  inlineCompletionModel: string;

  setEnabled: (enabled: boolean) => void;
  updateSettings: (settings: Partial<AiSettingsValues>) => void;
  assistantProviderConfig: () => AiProviderConfig | null;
  inlineProviderConfig: () => AiHttpProviderConfig | null;
}

export type AiSettingsValues = Omit<
  AiSettingsState,
  | "setEnabled"
  | "updateSettings"
  | "assistantProviderConfig"
  | "inlineProviderConfig"
>;

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4.1-mini";
export const DEFAULT_CODEX_CLI_PROFILE_ID = "codex-cli:default";
export const DEFAULT_CODEBUDDY_CLI_PROFILE_ID = "codebuddy-cli:default";

function cliProviderConfig(
  state: AiSettingsState,
  kind: "codex-cli" | "codebuddy-cli",
): AiCliProviderConfig {
  const codex = kind === "codex-cli";
  return {
    kind,
    profileId: codex
      ? state.codexCliProfileId
      : state.codeBuddyCliProfileId,
    executablePath:
      (codex ? state.codexCliPath : state.codeBuddyCliPath).trim() || undefined,
    model:
      (codex ? state.codexCliModel : state.codeBuddyCliModel).trim() ||
      "default",
    reasoningEffort: cliReasoningEffortForModel(state, kind),
    timeoutMs: state.timeoutMs,
    environmentKeys: codex
      ? state.codexCliEnvironmentKeys
      : state.codeBuddyCliEnvironmentKeys,
  };
}

type PersistedAiSettings = Partial<AiSettingsValues> & {
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
};

function normalizedCliModel(model: string | undefined) {
  return model?.trim() || "default";
}

function cliReasoningEffortForModel(
  state: Pick<
    AiSettingsState,
    | "codexCliModel"
    | "codexCliReasoningEffort"
    | "codexCliReasoningEffortByModel"
    | "codeBuddyCliModel"
    | "codeBuddyCliReasoningEffort"
    | "codeBuddyCliReasoningEffortByModel"
  >,
  kind: "codex-cli" | "codebuddy-cli",
) {
  const codex = kind === "codex-cli";
  const model = normalizedCliModel(
    codex ? state.codexCliModel : state.codeBuddyCliModel,
  );
  const preferences = codex
    ? state.codexCliReasoningEffortByModel
    : state.codeBuddyCliReasoningEffortByModel;
  const legacy = codex
    ? state.codexCliReasoningEffort
    : state.codeBuddyCliReasoningEffort;
  // Version 4 seeds the previously selected model with the legacy value.
  // Once any per-model preference exists, an unseen model must use the
  // provider default instead of inheriting an incompatible prior override.
  return (
    preferences[model]?.trim() ||
    (Object.keys(preferences).length === 0 ? legacy : "default") ||
    "default"
  );
}

function withCliReasoningPreferences(
  state: AiSettingsState,
  settings: Partial<AiSettingsValues>,
): Partial<AiSettingsValues> {
  const next: Partial<AiSettingsValues> = { ...settings };
  const codexModel = normalizedCliModel(
    settings.codexCliModel ?? state.codexCliModel,
  );
  const codeBuddyModel = normalizedCliModel(
    settings.codeBuddyCliModel ?? state.codeBuddyCliModel,
  );

  if (settings.codexCliReasoningEffort !== undefined) {
    next.codexCliReasoningEffortByModel = {
      ...state.codexCliReasoningEffortByModel,
      ...settings.codexCliReasoningEffortByModel,
      [codexModel]: settings.codexCliReasoningEffort,
    };
  }
  if (settings.codeBuddyCliReasoningEffort !== undefined) {
    next.codeBuddyCliReasoningEffortByModel = {
      ...state.codeBuddyCliReasoningEffortByModel,
      ...settings.codeBuddyCliReasoningEffortByModel,
      [codeBuddyModel]: settings.codeBuddyCliReasoningEffort,
    };
  }
  return next;
}

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

export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      provider: "openai-compatible",
      plannerKind: "model",
      assistantMode: "o2",
      codexCliAssistantMode: "o2",
      codeBuddyCliAssistantMode: "o2",
      baseUrl: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: "",
      codexCliProfileId: DEFAULT_CODEX_CLI_PROFILE_ID,
      codexCliPath: "",
      codexCliModel: "default",
      codexCliReasoningEffort: "default",
      codexCliReasoningEffortByModel: {},
      codexCliEnvironmentKeys: [],
      codexCliEnvironmentDraft: {},
      codeBuddyCliProfileId: DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
      codeBuddyCliPath: "",
      codeBuddyCliModel: "default",
      codeBuddyCliReasoningEffort: "default",
      codeBuddyCliReasoningEffortByModel: {},
      codeBuddyCliEnvironmentKeys: [],
      codeBuddyCliEnvironmentDraft: {},
      timeoutMs: 30_000,
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      maxInputTokens: 32_768,
      maxOutputTokens: 4_096,
      inlineBaseUrl: DEFAULT_AI_BASE_URL,
      inlineApiKey: "",
      inlineTimeoutMs: 4_000,
      inlineCompletionProtocol: "chat-completions",
      inlineCompletionModel: DEFAULT_AI_MODEL,
      setEnabled: (enabled) => set({ enabled }),
      updateSettings: (settings) =>
        set((state) => withCliReasoningPreferences(state, settings)),
      assistantProviderConfig: () => {
        const state = get();
        if (!state.enabled) return null;
        if (state.provider !== "openai-compatible") {
          return cliProviderConfig(state, state.provider);
        }
        const baseUrl = state.baseUrl.trim();
        const model = state.model.trim();
        if (!baseUrl || !model) return null;
        return {
          kind: "openai-compatible",
          baseUrl,
          model,
          apiKey: state.apiKey.trim() || undefined,
          timeoutMs: state.timeoutMs,
        };
      },
      inlineProviderConfig: () => {
        const state = get();
        const baseUrl = state.inlineBaseUrl.trim();
        const model = state.inlineCompletionModel.trim();
        if (!baseUrl || !model) return null;
        return {
          kind: "openai-compatible",
          baseUrl,
          model,
          apiKey: state.inlineApiKey.trim() || undefined,
          timeoutMs: state.inlineTimeoutMs,
        };
      },
    }),
    {
      name: "oxide-ai-settings",
      version: 4,
      migrate: migratePersistedAiSettings,
      partialize: (state) => ({
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
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
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
            .setProviderSecret(state.inlineBaseUrl, legacyInlineSecret)
            .then(() => state.updateSettings({ inlineApiKey: "" }))
            .catch(() => undefined);
        }
      },
    },
  ),
);
