import { CLI_PROBE_TTL_MS } from "@/features/assistant-panel/model/providerIdentity";
import {
  cliSetupPhaseForFailure,
  isAuthenticationError,
} from "@/features/assistant-panel/model/providerPresentation";
import type { AssistantAgentSession } from "@/features/assistant-session/model/sessionTypes";
import type { useI18n } from "@/i18n";
import type { AiProviderConfig } from "@/services/tauri/ai.service";
import {
  aiService,
  type AiCliProviderConfig,
  type AiProviderKind,
} from "@/services/tauri/ai.service";
import type { AiSettingsValues } from "@/store/useAiSettingsStore";
import type {
  AssistantCliSetupState,
  useAssistantCliSetupStore,
} from "@/store/useAssistantCliSetupStore";
import { useEffect } from "react";

interface AssistantProviderLifecycleContext {
  session: Pick<AssistantAgentSession, "isBusy" | "refreshStatus">;
  aiProvider: AiProviderKind;
  cliSetupByProvider: ReturnType<
    typeof useAssistantCliSetupStore.getState
  >["setupByProvider"];
  authIssueId: string | null;
  setDismissedAuthIssueId: React.Dispatch<React.SetStateAction<string | null>>;
  updateCliSetup: ReturnType<
    typeof useAssistantCliSetupStore.getState
  >["updateSetup"];
  t: ReturnType<typeof useI18n>["t"];
  updateAiSettings: (settings: Partial<AiSettingsValues>) => void;
  requestCliDetection: ReturnType<
    typeof useAssistantCliSetupStore.getState
  >["requestDetection"];
  modelConfig: AiProviderConfig | null;
  cliSetup: AssistantCliSetupState | null;
  cliProviderFingerprint: string | null;
  cliProbeIdentity:
    | ReturnType<
        typeof useAssistantCliSetupStore.getState
      >["probeIdentityByProvider"]["codex-cli" | "codebuddy-cli"]
    | null;
  cliDetectionRevision: number;
  completeCliProbe: ReturnType<
    typeof useAssistantCliSetupStore.getState
  >["completeProbe"];
}

export function useAssistantProviderLifecycle({
  session,
  aiProvider,
  cliSetupByProvider,
  authIssueId,
  setDismissedAuthIssueId,
  updateCliSetup,
  t,
  updateAiSettings,
  requestCliDetection,
  modelConfig,
  cliSetup,
  cliProviderFingerprint,
  cliProbeIdentity,
  cliDetectionRevision,
  completeCliProbe,
}: AssistantProviderLifecycleContext) {
  const selectAssistantProvider = (provider: AiProviderKind) => {
    if (session.isBusy) return;
    if (
      (aiProvider === "codex-cli" || aiProvider === "codebuddy-cli") &&
      aiProvider !== provider
    ) {
      const activeSetup = cliSetupByProvider[aiProvider];
      if (
        activeSetup?.phase === "authorizing" &&
        activeSetup.authenticationSessionId
      ) {
        void aiService
          .cancelCliAuthentication(activeSetup.authenticationSessionId)
          .catch(() => undefined);
      }
    }
    if (authIssueId) setDismissedAuthIssueId(authIssueId);
    if (provider !== "openai-compatible" && !cliSetupByProvider[provider]) {
      updateCliSetup(provider, {
        phase: "checking",
        message: t("assistant.setup.verifying"),
      });
    }
    updateAiSettings({
      enabled: true,
      provider,
    });
  };

  const retryAssistantProvider = () => {
    if (authIssueId) setDismissedAuthIssueId(authIssueId);
    if (aiProvider === "codex-cli" || aiProvider === "codebuddy-cli") {
      updateCliSetup(aiProvider, (current) =>
        current && current.phase !== "ready" && current.phase !== "checking"
          ? {
              ...current,
              message: t("assistant.setup.verifyingAgain"),
              refreshing: true,
            }
          : {
              phase: "checking",
              message: t("assistant.setup.verifyingAgain"),
            },
      );
      requestCliDetection(aiProvider);
      return;
    }
    void session.refreshStatus();
  };

  const installAssistantProvider = async () => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") return;
    const provider = modelConfig.kind;
    try {
      const installation = await aiService.beginCliInstallation(provider);
      updateCliSetup(provider, {
        phase: "installing",
        message: installation.message,
        installationSessionId: installation.sessionId,
      });
    } catch (error) {
      updateCliSetup(provider, {
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const authenticateAssistantProvider = async (methodId?: string) => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") return;
    const provider = modelConfig.kind;
    try {
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "authorizing",
        message: t("assistant.setup.startingSignIn"),
        authenticationMethodId: methodId,
      }));
      const result = await aiService.beginCliAuthentication(
        modelConfig,
        methodId,
      );
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "authorizing",
        message: result.message,
        authenticationSessionId: result.sessionId,
        authenticationMethodId: methodId,
      }));
    } catch (error) {
      updateCliSetup(provider, (current) => ({
        phase: cliSetupPhaseForFailure(error),
        message: error instanceof Error ? error.message : String(error),
        executablePath: current?.executablePath,
        version: current?.version,
        authenticationSessionId: undefined,
        refreshing: false,
      }));
    }
  };

  const cancelAssistantAuthentication = async () => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") return;
    const sessionId = cliSetup?.authenticationSessionId;
    if (!sessionId) {
      updateCliSetup(modelConfig.kind, (current) => ({
        ...current,
        phase: "auth-required",
        message: t("assistant.setup.signInCancelled"),
      }));
      return;
    }
    try {
      const status = await aiService.cancelCliAuthentication(sessionId);
      updateCliSetup(modelConfig.kind, (current) => ({
        ...current,
        phase: "auth-required",
        message: status.message,
        authenticationSessionId: undefined,
      }));
    } catch (error) {
      updateCliSetup(modelConfig.kind, (current) => ({
        ...current,
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  useEffect(() => {
    if (
      cliSetup?.phase !== "installing" ||
      !modelConfig ||
      modelConfig.kind === "openai-compatible"
    ) {
      return;
    }
    const provider = modelConfig.kind;
    const installationSessionId = cliSetup.installationSessionId;
    if (!installationSessionId) {
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "error",
        message: t("assistant.setup.installInterrupted"),
      }));
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    const poll = () => {
      void aiService
        .getCliInstallationStatus(installationSessionId)
        .then((status) => {
          if (disposed) return;
          if (status.phase === "succeeded" && status.result) {
            const executablePath = status.result.executablePath;
            updateAiSettings(
              provider === "codex-cli"
                ? { codexCliPath: executablePath }
                : { codeBuddyCliPath: executablePath },
            );
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "checking",
              message: t("assistant.setup.installComplete"),
              executablePath,
              installationSessionId: undefined,
              refreshing: true,
            }));
            requestCliDetection(provider);
            return;
          }
          if (status.phase === "failed") {
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "error",
              message: status.message,
              installationSessionId: undefined,
              refreshing: false,
            }));
            return;
          }
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "installing",
            message: status.message,
            installationSessionId,
          }));
          timer = window.setTimeout(poll, 750);
        })
        .catch((error) => {
          if (disposed) return;
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "error",
            message:
              error instanceof Error
                ? error.message
                : t("assistant.setup.resumeInstallFailed"),
            installationSessionId: undefined,
          }));
        });
    };
    poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    cliProviderFingerprint,
    cliSetup?.installationSessionId,
    cliSetup?.phase,
    requestCliDetection,
    t,
    updateAiSettings,
    updateCliSetup,
  ]);

  useEffect(() => {
    if (!modelConfig || modelConfig.kind === "openai-compatible") {
      return;
    }
    const provider = modelConfig.kind;
    const probeFingerprint =
      cliProviderFingerprint ?? `provider:${modelConfig.kind}`;
    const probeFresh =
      cliProbeIdentity?.verifiedAt !== undefined &&
      Date.now() - cliProbeIdentity.verifiedAt < CLI_PROBE_TTL_MS;
    if (
      cliProbeIdentity?.fingerprint === probeFingerprint &&
      cliProbeIdentity.completedRevision === cliDetectionRevision &&
      probeFresh
    ) {
      return;
    }
    let disposed = false;
    updateCliSetup(provider, (current) =>
      current && current.phase !== "ready" && current.phase !== "checking"
        ? {
            ...current,
            message: t("assistant.setup.verifying"),
            refreshing: true,
          }
        : {
            phase: "checking",
            message: t("assistant.setup.verifying"),
          },
    );
    void aiService
      .detectCliProvider(modelConfig)
      .then(async (result) => {
        if (disposed) return;
        if (!result.available) {
          updateCliSetup(provider, {
            phase: "missing",
            message: result.message,
            executablePath: result.executablePath,
            version: result.version,
          });
          completeCliProbe(provider, probeFingerprint, cliDetectionRevision);
          return;
        }
        updateCliSetup(provider, (current) => ({
          phase: current?.phase === "installing" ? "installing" : "checking",
          message: t("assistant.setup.cliDetected"),
          executablePath: result.executablePath,
          version: result.version,
        }));
        try {
          const tested = await aiService.testProvider(modelConfig);
          if (disposed) return;
          updateCliSetup(provider, {
            phase: "ready",
            message: tested.message,
            executablePath: tested.executablePath || result.executablePath,
            version: tested.version || result.version,
          });
          completeCliProbe(provider, probeFingerprint, cliDetectionRevision);
        } catch (error) {
          if (disposed) return;
          const message =
            error instanceof Error ? error.message : String(error);
          updateCliSetup(provider, {
            phase: isAuthenticationError(error) ? "auth-required" : "error",
            message,
            executablePath: result.executablePath,
            version: result.version,
          });
          completeCliProbe(provider, probeFingerprint, cliDetectionRevision);
        }
      })
      .catch((error) => {
        if (disposed) return;
        updateCliSetup(provider, {
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        completeCliProbe(provider, probeFingerprint, cliDetectionRevision);
      });
    return () => {
      disposed = true;
    };
  }, [
    cliDetectionRevision,
    cliProbeIdentity?.completedRevision,
    cliProbeIdentity?.fingerprint,
    cliProbeIdentity?.verifiedAt,
    cliProviderFingerprint,
    completeCliProbe,
    t,
    updateAiSettings,
    updateCliSetup,
  ]);

  useEffect(() => {
    if (
      cliSetup?.phase !== "auth-required" ||
      cliSetup.authenticationMethods?.length ||
      cliSetup.authMethodsLoading ||
      !modelConfig ||
      modelConfig.kind === "openai-compatible"
    ) {
      return;
    }
    const provider = modelConfig.kind;
    updateCliSetup(provider, (current) => ({
      ...current,
      phase: "auth-required",
      message: current?.message ?? t("assistant.setup.chooseSignIn"),
      authMethodsLoading: true,
    }));
    void aiService
      .listCliAuthenticationMethods(modelConfig)
      .then((methods) => {
        updateCliSetup(provider, (current) => ({
          ...current,
          phase: "auth-required",
          message: current?.message ?? t("assistant.setup.chooseSignIn"),
          authenticationMethods: methods,
          authMethodsLoading: false,
        }));
      })
      .catch((error) => {
        updateCliSetup(provider, (current) => ({
          ...current,
          phase: "auth-required",
          message: error instanceof Error ? error.message : String(error),
          authMethodsLoading: false,
        }));
      });
  }, [cliProviderFingerprint, cliSetup?.phase, t, updateCliSetup]);

  useEffect(() => {
    if (
      cliSetup?.phase !== "authorizing" ||
      !modelConfig ||
      modelConfig.kind === "openai-compatible"
    ) {
      return;
    }
    let disposed = false;
    const config: AiCliProviderConfig = modelConfig;
    const provider = config.kind;
    const authenticationSessionId = cliSetup.authenticationSessionId;
    if (!authenticationSessionId) {
      updateCliSetup(provider, (current) => ({
        ...current,
        phase: "auth-required",
        message: t("assistant.setup.signInInterrupted"),
      }));
      return;
    }
    let timer: number | undefined;
    const poll = () => {
      void aiService
        .getCliAuthenticationStatus(authenticationSessionId)
        .then(async (status) => {
          if (disposed) return;
          if (status.phase === "succeeded") {
            let result;
            try {
              result = await aiService.testProvider(config);
            } catch (error) {
              if (disposed) return;
              updateCliSetup(provider, (current) => ({
                ...current,
                phase: cliSetupPhaseForFailure(error),
                message:
                  cliSetupPhaseForFailure(error) === "auth-required"
                    ? t("assistant.setup.signInVerificationFailed")
                    : error instanceof Error
                      ? error.message
                      : String(error),
                authenticationSessionId: undefined,
                refreshing: false,
              }));
              return;
            }
            if (disposed) return;
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "ready",
              message: result.message,
              executablePath: result.executablePath,
              version: result.version,
              authenticationSessionId: undefined,
              refreshing: false,
            }));
            void session.refreshStatus();
            return;
          }
          if (["failed", "cancelled", "expired"].includes(status.phase)) {
            updateCliSetup(provider, (current) => ({
              ...current,
              phase: "auth-required",
              message: status.message,
              authenticationSessionId: undefined,
              refreshing: false,
            }));
            return;
          }
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "authorizing",
            message: status.message,
            authenticationSessionId,
            authenticationMethodId: status.methodId,
          }));
          timer = window.setTimeout(poll, 1_000);
        })
        .catch((error) => {
          if (disposed) return;
          const message =
            error instanceof Error ? error.message : String(error);
          updateCliSetup(provider, (current) => ({
            ...current,
            phase: "error",
            message,
          }));
        });
    };
    poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    cliSetup?.authenticationSessionId,
    cliSetup?.phase,
    cliProviderFingerprint,
    session.refreshStatus,
    t,
    updateAiSettings,
    updateCliSetup,
  ]);

  return {
    selectAssistantProvider,
    retryAssistantProvider,
    installAssistantProvider,
    authenticateAssistantProvider,
    cancelAssistantAuthentication,
  };
}
