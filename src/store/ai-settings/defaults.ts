import type { AiSettingsValues } from "./contracts";

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4.1-mini";
export const DEFAULT_CODEX_CLI_PROFILE_ID = "codex-cli:default";
export const DEFAULT_CODEBUDDY_CLI_PROFILE_ID = "codebuddy-cli:default";

export function createInitialAiSettingsValues(): AiSettingsValues {
  return {
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
    codexCliServiceTier: "default",
    codexCliAccessMode: "restricted",
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
  };
}
