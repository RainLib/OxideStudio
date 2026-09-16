import type { AssistantModelStatus } from "@/components/workspace/assistant/AssistantModelControl";
import { type AssistantCliSetupState } from "@/components/workspace/assistant/AssistantProviderSetup";
import { useI18n } from "@/i18n";
import {
  type AiProviderConfig,
  type AiProviderKind,
} from "@/services/tauri/ai.service";
import { ApiError } from "@/services/tauri/types";

export function resolveModelUiState({
  enabled,
  providerKind,
  baseUrl,
  model,
  resolvedMode,
  toolCalling,
  availability,
  hostCapabilities,
  hostInstalledTools,
  authenticationError,
  cliSetup,
  t,
}: {
  enabled: boolean;
  providerKind: AiProviderKind;
  baseUrl: string;
  model: string;
  resolvedMode: "chat" | "plan" | "agent";
  toolCalling: boolean;
  availability: "checking" | "available" | "unavailable";
  hostCapabilities: string[] | null;
  hostInstalledTools: string[] | null;
  authenticationError: string | null;
  cliSetup: AssistantCliSetupState | null;
  t: ReturnType<typeof useI18n>["t"];
}): {
  modelStatus: AssistantModelStatus;
  submissionBlockReason: string | null;
} {
  const endpoint = endpointLabel(baseUrl);
  if (!enabled || !baseUrl.trim() || !model.trim()) {
    const detail = !enabled
      ? t("assistant.status.configureProvider")
      : !baseUrl.trim()
        ? t("assistant.status.configureEndpoint")
        : t("assistant.status.chooseModel");
    return {
      modelStatus: {
        kind: "missing",
        label: t("assistant.status.setupRequired"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (cliSetup && cliSetup.phase !== "ready") {
    const detail = cliSetup.message;
    return {
      modelStatus: {
        kind:
          cliSetup.phase === "checking" || cliSetup.phase === "installing"
            ? "checking"
            : cliSetup.phase === "auth-required" ||
                cliSetup.phase === "authorizing"
              ? "authentication-error"
              : "unavailable",
        label:
          cliSetup.phase === "installing"
            ? t("assistant.status.installingCli")
            : cliSetup.phase === "auth-required" ||
                cliSetup.phase === "authorizing"
              ? t("assistant.status.authenticationRequired")
              : t("assistant.status.cliSetupRequired"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (authenticationError) {
    const detail =
      providerKind === "openai-compatible"
        ? t("assistant.status.httpAuthenticationDetail")
        : t("assistant.status.cliAuthenticationDetail");
    return {
      modelStatus: {
        kind: "authentication-error",
        label: t("assistant.status.authenticationFailed"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (resolvedMode !== "chat" && !toolCalling) {
    const detail = t("assistant.status.toolCallingRequired", {
      mode: assistantModeLabel(resolvedMode, t),
    });
    return {
      modelStatus: {
        kind: "incompatible",
        label: t("assistant.status.modelCapabilityRequired"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    hostCapabilities &&
    hostCapabilities.length > 0 &&
    !hostCapabilities.includes(resolvedMode)
  ) {
    const detail = t("assistant.status.runtimeDoesNotSupport", {
      mode: assistantModeLabel(resolvedMode, t),
    });
    return {
      modelStatus: {
        kind: "incompatible",
        label: t("assistant.status.modeUnavailable"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    resolvedMode !== "chat" &&
    (!hostInstalledTools || hostInstalledTools.length === 0)
  ) {
    const detail = t("assistant.status.toolsUnavailable");
    return {
      modelStatus: {
        kind: "checking",
        label: t("assistant.status.checkingTools"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (availability === "checking") {
    const detail = t("assistant.status.runtimeStarting");
    return {
      modelStatus: {
        kind: "checking",
        label: t("assistant.status.startingRuntime"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (
    availability === "available" &&
    (!hostCapabilities || hostCapabilities.length === 0)
  ) {
    const detail = t("assistant.status.runtimeChecking");
    return {
      modelStatus: {
        kind: "checking",
        label: t("assistant.status.checkingRuntime"),
        detail,
      },
      submissionBlockReason: detail,
    };
  }

  if (availability === "unavailable") {
    const detail = t("assistant.status.runtimeUnavailable");
    return {
      modelStatus: {
        kind: "unavailable",
        label: t("assistant.status.unavailable"),
        detail,
      },
      submissionBlockReason: t("assistant.status.runtimeUnavailableAction", {
        detail,
      }),
    };
  }

  return {
    modelStatus: {
      kind: "configured",
      label: t("assistant.status.modelConfigured"),
      detail: t("assistant.status.requestDestination", { endpoint }),
    },
    submissionBlockReason: null,
  };
}

function assistantModeLabel(
  mode: "chat" | "plan" | "agent",
  t: ReturnType<typeof useI18n>["t"],
) {
  return t(
    mode === "chat"
      ? "assistant.status.modeChat"
      : mode === "plan"
        ? "assistant.status.modePlan"
        : "assistant.status.modeAgent",
  );
}

export function isAuthenticationError(error: unknown) {
  if (error instanceof ApiError) {
    return error.code === "AI_CLI_AUTH_REQUIRED";
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\b401\b|unauthori[sz]ed|not\s+authenticated|not\s+logged\s+in|sign\s+in|authentication\s+failed|incorrect\s+(?:api[- ]?)?key|invalid\s+(?:api[- ]?)?key/iu.test(
    message,
  );
}

export function cliSetupPhaseForFailure(
  error: unknown,
): AssistantCliSetupState["phase"] {
  if (error instanceof ApiError) {
    if (error.code === "AI_CLI_AUTH_REQUIRED") return "auth-required";
    if (error.code === "AI_CLI_NOT_INSTALLED") return "missing";
  }
  return isAuthenticationError(error) ? "auth-required" : "error";
}

function endpointLabel(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname || "the configured endpoint";
  } catch {
    return "the configured endpoint";
  }
}

export function providerDestinationLabel(provider: AiProviderConfig) {
  if (provider.kind === "codex-cli") return `${provider.model} · Codex CLI`;
  if (provider.kind === "codebuddy-cli") {
    return `${provider.model} · CodeBuddy Code CLI`;
  }

  try {
    const hostname = new URL("baseUrl" in provider ? provider.baseUrl : "")
      .hostname;
    return hostname
      ? `${provider.model} · ${hostname}`
      : `${provider.model} · custom endpoint`;
  } catch {
    return `${provider.model} · custom endpoint`;
  }
}
