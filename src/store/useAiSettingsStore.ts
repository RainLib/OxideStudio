import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AiProviderConfig } from "@/services/tauri/ai.service";
import type { AssistantMode } from "@/ai/assistant/modes";

export type AiProviderKind = "openai-compatible";
export type AiPlannerKind = "model" | "langgraph" | "local";
export type InlineCompletionProtocol =
  | "chat-completions"
  | "text-completions-fim";

export interface AiSettingsState {
  enabled: boolean;
  provider: AiProviderKind;
  plannerKind: AiPlannerKind;
  assistantMode: AssistantMode;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  inlineCompletionProtocol: InlineCompletionProtocol;
  inlineCompletionModel: string;
  setEnabled: (enabled: boolean) => void;
  updateSettings: (settings: Partial<AiSettingsValues>) => void;
  providerConfig: () => AiProviderConfig | null;
}

export type AiSettingsValues = Pick<
  AiSettingsState,
  | "enabled"
  | "provider"
  | "plannerKind"
  | "assistantMode"
  | "baseUrl"
  | "model"
  | "apiKey"
  | "timeoutMs"
  | "inlineCompletionProtocol"
  | "inlineCompletionModel"
>;

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4.1-mini";

export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      provider: "openai-compatible",
      plannerKind: "model",
      assistantMode: "o2",
      baseUrl: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: "",
      timeoutMs: 30_000,
      inlineCompletionProtocol: "chat-completions",
      inlineCompletionModel: "",
      setEnabled: (enabled) => set({ enabled }),
      updateSettings: (settings) => set(settings),
      providerConfig: () => {
        const state = get();
        const baseUrl = state.baseUrl.trim();
        const model = state.model.trim();
        if (!state.enabled || !baseUrl || !model) {
          return null;
        }

        return {
          baseUrl,
          model,
          apiKey: state.apiKey.trim() || undefined,
          timeoutMs: state.timeoutMs,
        };
      },
    }),
    {
      name: "oxide-ai-settings",
      partialize: (state) => ({
        enabled: state.enabled,
        provider: state.provider,
        plannerKind: state.plannerKind,
        assistantMode: state.assistantMode,
        baseUrl: state.baseUrl,
        model: state.model,
        apiKey: state.apiKey,
        timeoutMs: state.timeoutMs,
        inlineCompletionProtocol: state.inlineCompletionProtocol,
        inlineCompletionModel: state.inlineCompletionModel,
      }),
    }
  )
);
