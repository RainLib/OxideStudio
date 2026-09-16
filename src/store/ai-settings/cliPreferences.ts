import type {
  AiCliProviderConfig,
  AiCliReasoningEffort,
} from "@/services/tauri/ai.service";
import type { AiSettingsState, AiSettingsValues } from "./contracts";

export type AiCliProviderKind = "codex-cli" | "codebuddy-cli";

export function normalizedCliModel(model: string | undefined) {
  return model?.trim() || "default";
}

export function cliReasoningEffortForModel(
  state: Pick<
    AiSettingsState,
    | "codexCliModel"
    | "codexCliReasoningEffort"
    | "codexCliReasoningEffortByModel"
    | "codeBuddyCliModel"
    | "codeBuddyCliReasoningEffort"
    | "codeBuddyCliReasoningEffortByModel"
  >,
  kind: AiCliProviderKind,
): AiCliReasoningEffort {
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
  const selected =
    preferences[model]?.trim() ||
    (Object.keys(preferences).length === 0 ? legacy : "default") ||
    "default";
  return selected.toLowerCase() === "enabled" ? "default" : selected;
}

export function withCliReasoningPreferences(
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

export function cliProviderConfig(
  state: AiSettingsState,
  kind: AiCliProviderKind,
): AiCliProviderConfig {
  const codex = kind === "codex-cli";
  const reasoningEffort = cliReasoningEffortForModel(state, kind);
  const fullAccessActive =
    codex &&
    state.codexCliAccessMode === "full" &&
    state.codexCliAssistantMode === "agent" &&
    reasoningEffort.trim().toLowerCase() === "ultra";
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
    reasoningEffort,
    serviceTier: codex ? state.codexCliServiceTier : undefined,
    accessMode: codex ? (fullAccessActive ? "full" : "restricted") : undefined,
    timeoutMs: state.timeoutMs,
    environmentKeys: codex
      ? state.codexCliEnvironmentKeys
      : state.codeBuddyCliEnvironmentKeys,
  };
}
