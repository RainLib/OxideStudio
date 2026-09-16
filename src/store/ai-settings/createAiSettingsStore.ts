import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createAiSettingsActions } from "./actions";
import type { AiSettingsState } from "./contracts";
import { createInitialAiSettingsValues } from "./defaults";
import {
  AI_SETTINGS_PERSIST_VERSION,
  AI_SETTINGS_STORAGE_KEY,
  migrateLegacyAiSecrets,
  migratePersistedAiSettings,
  persistedAiSettings,
} from "./persistence";
import {
  assistantProviderConfigForState,
  inlineProviderConfigForState,
} from "./providerConfig";

export function createAiSettingsStore() {
  return create<AiSettingsState>()(
    persist(
      (set, get) => ({
        ...createInitialAiSettingsValues(),
        ...createAiSettingsActions(set),
        assistantProviderConfig: () => assistantProviderConfigForState(get()),
        inlineProviderConfig: () => inlineProviderConfigForState(get()),
      }),
      {
        name: AI_SETTINGS_STORAGE_KEY,
        version: AI_SETTINGS_PERSIST_VERSION,
        migrate: migratePersistedAiSettings,
        partialize: persistedAiSettings,
        onRehydrateStorage: () => migrateLegacyAiSecrets,
      },
    ),
  );
}
