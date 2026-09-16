import type { AiSettingsSet, AiSettingsValues } from "./contracts";
import { withCliReasoningPreferences } from "./cliPreferences";

export function createAiSettingsActions(set: AiSettingsSet) {
  return {
    setEnabled: (enabled: boolean) => set({ enabled }),
    updateSettings: (settings: Partial<AiSettingsValues>) =>
      set((state) => withCliReasoningPreferences(state, settings)),
  };
}
