import type {
  AiHttpProviderConfig,
  AiProviderConfig,
} from "@/services/tauri/ai.service";
import type { AiSettingsState } from "./contracts";
import { cliProviderConfig } from "./cliPreferences";

export function assistantProviderConfigForState(
  state: AiSettingsState,
): AiProviderConfig | null {
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
}

export function inlineProviderConfigForState(
  state: AiSettingsState,
): AiHttpProviderConfig | null {
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
}
