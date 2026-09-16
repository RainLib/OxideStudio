import { type AssistantCliSetupState } from "@/components/workspace/assistant/AssistantProviderSetup";
import { aiService, type AiProviderConfig } from "@/services/tauri/ai.service";

export const CLI_PROBE_TTL_MS = 5 * 60 * 1_000;

export function cliProviderIdentityFingerprint(
  provider: AiProviderConfig | null,
  environmentRevision?: string,
) {
  if (!provider || provider.kind === "openai-compatible") return null;
  return JSON.stringify({
    kind: provider.kind,
    profileId: provider.profileId,
    executablePath: provider.executablePath || "",
    environmentKeys: [...(provider.environmentKeys || [])].sort(),
    environmentRevision:
      environmentRevision ??
      aiService.getCliEnvironmentRevision(provider.kind, provider.profileId),
  });
}

export function selectedCliReasoningEffort(
  preferences: Record<string, string>,
  model: string,
  legacyEffort: string,
) {
  const selected = preferences[model.trim() || "default"]?.trim();
  const effort =
    selected ||
    (Object.keys(preferences).length === 0 ? legacyEffort : "default");
  return effort.trim().toLowerCase() === "enabled" ? "default" : effort;
}

export function cliSetupForProviderIdentity(
  setup: AssistantCliSetupState | null,
  expectedFingerprint: string | null,
  verifiedFingerprint: string | undefined,
  checkingMessage: string,
) {
  if (!setup || !expectedFingerprint || !verifiedFingerprint) return setup;
  if (expectedFingerprint === verifiedFingerprint) return setup;
  // State belongs to a provider kind in the setup store, but a ready result is
  // only safe for the exact executable/profile/environment that was checked.
  // Render the transitional state immediately while the detection effect
  // verifies the new identity, rather than lending its old authorization to a
  // newly selected CLI.
  return {
    ...setup,
    phase: "checking" as const,
    message: checkingMessage,
    refreshing: true,
  };
}
