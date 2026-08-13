import type { useI18n } from "@/i18n";
import type { AssistantCliSetupState } from "@/store/useAssistantCliSetupStore";

/**
 * Keeps provider process output out of primary UI copy. Providers may return
 * localized, version-specific, or diagnostic-heavy text; the stable phase is
 * the safe renderer-facing source of truth and the raw output stays available
 * as a collapsed technical detail.
 */
export function localizedCliSetupStatus(
  state: AssistantCliSetupState,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (state.phase) {
    case "checking":
      return t("assistant.setup.statusChecking");
    case "missing":
      return t("assistant.setup.statusMissing");
    case "installing":
      return t("assistant.setup.statusInstalling");
    case "auth-required":
      return t("assistant.setup.statusAuthRequired");
    case "authorizing":
      return t("assistant.setup.statusAuthorizing");
    case "ready":
      return t("assistant.setup.statusReady");
    case "error":
      return t("assistant.setup.statusError");
  }
}
