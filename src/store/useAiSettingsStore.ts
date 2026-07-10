import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AiProviderConfig } from "@/services/tauri/ai.service";

export type AiProviderKind = "openai-compatible";
export type AiPlannerKind = "model" | "langgraph" | "local";

export interface AiSettingsState {
  enabled: boolean;
  provider: AiProviderKind;
  plannerKind: AiPlannerKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  setEnabled: (enabled: boolean) => void;
  updateSettings: (settings: Partial<AiSettingsValues>) => void;
  providerConfig: () => AiProviderConfig | null;
}

export type AiSettingsValues = Pick<
  AiSettingsState,
  | "enabled"
  | "provider"
  | "plannerKind"
  | "baseUrl"
  | "model"
  | "apiKey"
  | "timeoutMs"
>;

export const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_AI_MODEL = "gpt-4.1-mini";

export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      provider: "openai-compatible",
      plannerKind: "model",
      baseUrl: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      apiKey: "",
      timeoutMs: 30_000,
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
        baseUrl: state.baseUrl,
        model: state.model,
        apiKey: state.apiKey,
        timeoutMs: state.timeoutMs,
      }),
    }
  )
);
