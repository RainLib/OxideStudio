import type {
  AiSettingsProvider,
  UpdateAiSettings,
} from "@/features/settings/ui/aiSettingsTypes";
import {
  aiService,
  type AiCliModelInfo,
  type AiCliProviderConfig,
  type AiCliReasoningEffort,
} from "@/services/tauri/ai.service";
import { useEffect, useState } from "react";

interface UseAiCliSettingsOptions {
  aiProvider: AiSettingsProvider;
  aiTimeoutMs: number;
  codexCliProfileId: string;
  codexCliPath: string;
  codexCliModel: string;
  codexCliReasoningEffort: AiCliReasoningEffort;
  codexCliEnvironmentDraft: Record<string, string>;
  codeBuddyCliProfileId: string;
  codeBuddyCliPath: string;
  codeBuddyCliModel: string;
  codeBuddyCliReasoningEffort: AiCliReasoningEffort;
  codeBuddyCliEnvironmentDraft: Record<string, string>;
  updateAiSettings: UpdateAiSettings;
}

/** CLI configuration discovery and credential-store environment lifecycle. */
export function useAiCliSettings({
  aiProvider,
  aiTimeoutMs,
  codexCliProfileId,
  codexCliPath,
  codexCliModel,
  codexCliReasoningEffort,
  codexCliEnvironmentDraft,
  codeBuddyCliProfileId,
  codeBuddyCliPath,
  codeBuddyCliModel,
  codeBuddyCliReasoningEffort,
  codeBuddyCliEnvironmentDraft,
  updateAiSettings,
}: UseAiCliSettingsOptions) {
  const [cliModels, setCliModels] = useState<AiCliModelInfo[]>([]);
  const [cliEfforts, setCliEfforts] = useState<string[]>([]);
  const [cliStatus, setCliStatus] = useState<{
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  }>({ status: "idle" });
  const cliConfig: AiCliProviderConfig | null =
    aiProvider === "codex-cli"
      ? {
          kind: "codex-cli",
          profileId: codexCliProfileId,
          executablePath: codexCliPath.trim() || undefined,
          model: codexCliModel.trim() || "default",
          reasoningEffort: codexCliReasoningEffort,
          timeoutMs: aiTimeoutMs,
        }
      : aiProvider === "codebuddy-cli"
        ? {
            kind: "codebuddy-cli",
            profileId: codeBuddyCliProfileId,
            executablePath: codeBuddyCliPath.trim() || undefined,
            model: codeBuddyCliModel.trim() || "default",
            reasoningEffort: codeBuddyCliReasoningEffort,
            timeoutMs: aiTimeoutMs,
          }
        : null;
  const cliEnvironment =
    aiProvider === "codex-cli"
      ? codexCliEnvironmentDraft
      : codeBuddyCliEnvironmentDraft;

  useEffect(() => {
    setCliModels([]);
    setCliEfforts([]);
    setCliStatus({ status: "idle" });
  }, [aiProvider, codexCliPath, codeBuddyCliPath]);

  const persistCliEnvironment = async () => {
    if (!cliConfig) return;
    const keys = await aiService.setCliEnvironment(
      cliConfig.kind,
      cliConfig.profileId,
      cliEnvironment,
    );
    updateAiSettings(
      cliConfig.kind === "codex-cli"
        ? { codexCliEnvironmentKeys: keys }
        : { codeBuddyCliEnvironmentKeys: keys },
    );
  };

  const detectCli = async () => {
    if (!cliConfig) return;
    setCliStatus({ status: "loading", message: "Detecting CLI..." });
    try {
      await persistCliEnvironment();
      const result = await aiService.detectCliProvider(cliConfig);
      if (result.available && result.executablePath) {
        updateAiSettings(
          cliConfig.kind === "codex-cli"
            ? { codexCliPath: result.executablePath }
            : { codeBuddyCliPath: result.executablePath },
        );
      }
      setCliStatus({
        status: result.available ? "success" : "error",
        message: result.version
          ? `${result.message} (${result.version})`
          : result.message,
      });
    } catch (error: unknown) {
      setCliStatus({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const refreshCliModels = async () => {
    if (!cliConfig) return;
    setCliStatus({ status: "loading", message: "Loading models..." });
    try {
      await persistCliEnvironment();
      const models = await aiService.listCliModels(cliConfig, {
        forceRefresh: true,
      });
      setCliModels(models);
      const efforts = await aiService
        .listCliEfforts(cliConfig, { forceRefresh: true })
        .catch(() => []);
      setCliEfforts(efforts);
      setCliStatus({
        status: "success",
        message: `Loaded ${models.length} model${models.length === 1 ? "" : "s"}.`,
      });
    } catch (error: unknown) {
      setCliStatus({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const selectCliExecutable = async () => {
    if (!cliConfig) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: false,
      multiple: false,
      title:
        cliConfig.kind === "codex-cli"
          ? "Choose Codex CLI executable"
          : "Choose CodeBuddy Code CLI executable",
    });
    if (typeof selected !== "string") return;
    updateAiSettings(
      cliConfig.kind === "codex-cli"
        ? { codexCliPath: selected }
        : { codeBuddyCliPath: selected },
    );
  };

  const updateCliEnvironmentText = (value: string) => {
    const environment = Object.fromEntries(
      value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf("=");
          return separator < 0
            ? [line, ""]
            : [line.slice(0, separator).trim(), line.slice(separator + 1)];
        }),
    );
    updateAiSettings(
      aiProvider === "codex-cli"
        ? { codexCliEnvironmentDraft: environment }
        : { codeBuddyCliEnvironmentDraft: environment },
    );
  };

  return {
    cliEnvironment,
    cliModels,
    cliEfforts,
    cliStatus,
    persistCliEnvironment,
    detectCli,
    refreshCliModels,
    selectCliExecutable,
    updateCliEnvironmentText,
  };
}
