import type {
  AiCliAccessMode,
  AiCliReasoningEffort,
  AiCliServiceTier,
  AiHttpProviderConfig,
  AiProviderConfig,
  AiProviderKind,
} from "@/services/tauri/ai.service";
import type { AssistantMode } from "@/ai/assistant/modes";
import type { StoreApi } from "zustand";

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
  baseUrl: string;
  model: string;
  apiKey: string;
  codexCliProfileId: string;
  codexCliPath: string;
  codexCliModel: string;
  codexCliReasoningEffort: AiCliReasoningEffort;
  codexCliReasoningEffortByModel: AiCliReasoningPreferences;
  codexCliServiceTier: AiCliServiceTier;
  codexCliAccessMode: AiCliAccessMode;
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

export type AiSettingsSet = StoreApi<AiSettingsState>["setState"];
export type AiSettingsGet = StoreApi<AiSettingsState>["getState"];
