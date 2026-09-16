import { createAiSettingsStore } from "./ai-settings/createAiSettingsStore";

export type {
  AiCliReasoningPreferences,
  AiPlannerKind,
  AiSettingsState,
  AiSettingsValues,
  InlineCompletionProtocol,
} from "./ai-settings/contracts";
export type { AiProviderKind } from "@/services/tauri/ai.service";
export {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
  DEFAULT_CODEX_CLI_PROFILE_ID,
} from "./ai-settings/defaults";
export { migratePersistedAiSettings } from "./ai-settings/persistence";

export const useAiSettingsStore = createAiSettingsStore();
