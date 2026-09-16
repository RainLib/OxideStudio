import { agentHostService } from "@/services/tauri/agent-host.service";
import { aiService } from "@/services/tauri/ai.service";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useEffect, useRef, useState } from "react";
export function useAiSettingsController(
  open: boolean,
  onOpenChange: (open: boolean) => void,
) {
  const aiEnabled = useAiSettingsStore((state) => state.enabled);

  const aiProvider = useAiSettingsStore((state) => state.provider);

  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);

  const aiModel = useAiSettingsStore((state) => state.model);

  const aiApiKey = useAiSettingsStore((state) => state.apiKey);

  const aiTimeoutMs = useAiSettingsStore((state) => state.timeoutMs);

  const aiStreaming = useAiSettingsStore((state) => state.streaming);

  const aiToolCalling = useAiSettingsStore((state) => state.toolCalling);

  const aiStructuredOutput = useAiSettingsStore(
    (state) => state.structuredOutput,
  );

  const aiMaxInputTokens = useAiSettingsStore((state) => state.maxInputTokens);

  const aiMaxOutputTokens = useAiSettingsStore(
    (state) => state.maxOutputTokens,
  );

  const aiInlineCompletionProtocol = useAiSettingsStore(
    (state) => state.inlineCompletionProtocol,
  );

  const aiInlineCompletionModel = useAiSettingsStore(
    (state) => state.inlineCompletionModel,
  );

  const aiInlineBaseUrl = useAiSettingsStore((state) => state.inlineBaseUrl);

  const aiInlineApiKey = useAiSettingsStore((state) => state.inlineApiKey);

  const aiInlineTimeoutMs = useAiSettingsStore(
    (state) => state.inlineTimeoutMs,
  );

  const codexCliProfileId = useAiSettingsStore(
    (state) => state.codexCliProfileId,
  );

  const codexCliPath = useAiSettingsStore((state) => state.codexCliPath);

  const codexCliModel = useAiSettingsStore((state) => state.codexCliModel);

  const codexCliReasoningEffort = useAiSettingsStore(
    (state) => state.codexCliReasoningEffort,
  );

  const codexCliEnvironmentDraft = useAiSettingsStore(
    (state) => state.codexCliEnvironmentDraft,
  );

  const codeBuddyCliProfileId = useAiSettingsStore(
    (state) => state.codeBuddyCliProfileId,
  );

  const codeBuddyCliPath = useAiSettingsStore(
    (state) => state.codeBuddyCliPath,
  );

  const codeBuddyCliModel = useAiSettingsStore(
    (state) => state.codeBuddyCliModel,
  );

  const codeBuddyCliReasoningEffort = useAiSettingsStore(
    (state) => state.codeBuddyCliReasoningEffort,
  );

  const codeBuddyCliEnvironmentDraft = useAiSettingsStore(
    (state) => state.codeBuddyCliEnvironmentDraft,
  );

  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const activeProjectName = useProjectStore((state) => state.activeProjectName);

  const setAiEnabled = useAiSettingsStore((state) => state.setEnabled);

  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);

  const [aiTestState, setAiTestState] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);

  const [isTestingAi, setIsTestingAi] = useState(false);

  const [isSavingAiSecret, setIsSavingAiSecret] = useState(false);

  const [hasAiProviderSecret, setHasAiProviderSecret] = useState(false);

  const [hasInlineProviderSecret, setHasInlineProviderSecret] = useState(false);

  const aiSecretSaveRef = useRef<Promise<boolean> | null>(null);

  const [isClearingAgentState, setIsClearingAgentState] = useState(false);

  const [agentStateMessage, setAgentStateMessage] = useState<{
    status: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    const baseUrl = aiBaseUrl.trim();
    if (!open || !baseUrl) {
      setHasAiProviderSecret(false);
      return;
    }
    let active = true;
    void aiService
      .hasProviderSecret(baseUrl, "assistant")
      .then((available) => {
        if (active) setHasAiProviderSecret(available);
      })
      .catch(() => {
        if (active) setHasAiProviderSecret(false);
      });
    return () => {
      active = false;
    };
  }, [aiBaseUrl, open]);

  useEffect(() => {
    const baseUrl = aiInlineBaseUrl.trim();
    if (!open || !baseUrl) {
      setHasInlineProviderSecret(false);
      return;
    }
    let active = true;
    void aiService
      .hasProviderSecret(baseUrl, "inline")
      .then((available) => {
        if (active) setHasInlineProviderSecret(available);
      })
      .catch(() => {
        if (active) setHasInlineProviderSecret(false);
      });
    return () => {
      active = false;
    };
  }, [aiInlineBaseUrl, open]);

  useEffect(() => {
    if (!open || aiProvider === "openai-compatible") return;
    const profileId =
      aiProvider === "codex-cli" ? codexCliProfileId : codeBuddyCliProfileId;
    void aiService
      .getCliEnvironment(aiProvider, profileId)
      .then((environment) =>
        updateAiSettings(
          aiProvider === "codex-cli"
            ? { codexCliEnvironmentDraft: environment }
            : { codeBuddyCliEnvironmentDraft: environment },
        ),
      )
      .catch(() => undefined);
  }, [
    aiProvider,
    codeBuddyCliProfileId,
    codexCliProfileId,
    open,
    updateAiSettings,
  ]);

  const canTestAi = Boolean(
    aiEnabled &&
      (aiProvider === "openai-compatible"
        ? aiBaseUrl.trim() && aiModel.trim()
        : aiProvider === "codex-cli"
          ? codexCliModel.trim()
          : codeBuddyCliModel.trim()),
  );

  const persistAiProviderSecret = (): Promise<boolean> => {
    if (aiSecretSaveRef.current) return aiSecretSaveRef.current;
    const secret = aiApiKey.trim();
    const baseUrl = aiBaseUrl.trim();
    if (!secret) return Promise.resolve(hasAiProviderSecret);
    if (!baseUrl) {
      setAiTestState({
        status: "error",
        message: "Enter the provider base URL before saving the API key.",
      });
      return Promise.resolve(false);
    }

    setIsSavingAiSecret(true);
    const operation = aiService
      .setProviderSecret(baseUrl, secret)
      .then((saved) => {
        if (!saved) {
          throw new Error(
            "The local credential file did not retain the API key.",
          );
        }
        updateAiSettings({ apiKey: "" });
        setHasAiProviderSecret(true);
        setAiTestState({
          status: "success",
          message: "API key saved and verified in the local credential file.",
        });
        return true;
      })
      .catch((error: any) => {
        setAiTestState({
          status: "error",
          message: error?.message || String(error),
        });
        return false;
      })
      .finally(() => {
        setIsSavingAiSecret(false);
        aiSecretSaveRef.current = null;
      });
    aiSecretSaveRef.current = operation;
    return operation;
  };

  const handleTestAiProvider = async () => {
    setAiTestState(null);
    setIsTestingAi(true);
    try {
      if (
        aiProvider === "openai-compatible" &&
        aiApiKey.trim() &&
        !(await persistAiProviderSecret())
      ) {
        return;
      }
      const provider = useAiSettingsStore.getState().assistantProviderConfig();
      if (!provider)
        throw new Error("Configure and enable an AI provider first.");
      if (provider.kind !== "openai-compatible") {
        const environment =
          provider.kind === "codex-cli"
            ? codexCliEnvironmentDraft
            : codeBuddyCliEnvironmentDraft;
        const keys = await aiService.setCliEnvironment(
          provider.kind,
          provider.profileId,
          environment,
        );
        updateAiSettings(
          provider.kind === "codex-cli"
            ? { codexCliEnvironmentKeys: keys }
            : { codeBuddyCliEnvironmentKeys: keys },
        );
      }
      const result = await aiService.testProvider(
        provider.kind === "openai-compatible"
          ? { ...provider, apiKey: undefined }
          : provider,
      );
      setAiTestState({
        status: "success",
        message: `${result.message}: ${result.model}${result.version ? ` (${result.version})` : ""}`,
      });
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
    } finally {
      setIsTestingAi(false);
    }
  };

  const persistInlineProviderSecret = async () => {
    const secret = aiInlineApiKey.trim();
    const baseUrl = aiInlineBaseUrl.trim();
    if (!secret || !baseUrl) return;
    setIsSavingAiSecret(true);
    try {
      await aiService.setProviderSecret(baseUrl, secret, "inline");
      updateAiSettings({ inlineApiKey: "" });
      setHasInlineProviderSecret(true);
      setAiTestState({
        status: "success",
        message:
          "Inline completion API key saved in the local credential file.",
      });
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
    } finally {
      setIsSavingAiSecret(false);
    }
  };

  const removeInlineProviderSecret = async () => {
    if (!aiInlineBaseUrl.trim()) return;
    await aiService.setProviderSecret(
      aiInlineBaseUrl.trim(),
      undefined,
      "inline",
    );
    updateAiSettings({ inlineApiKey: "" });
    setHasInlineProviderSecret(false);
  };

  const removeAiProviderSecret = async () => {
    if (!aiBaseUrl.trim()) return;
    try {
      await aiService.setProviderSecret(aiBaseUrl.trim());
      updateAiSettings({ apiKey: "" });
      setHasAiProviderSecret(false);
    } catch (error: any) {
      setAiTestState({
        status: "error",
        message: error?.message || String(error),
      });
    }
  };

  const clearCurrentProjectAgentState = async () => {
    const confirmed = window.confirm(
      `Clear saved AI conversations and checkpoints for “${activeProjectName}”? This cannot be undone.`,
    );
    if (!confirmed) return;
    setIsClearingAgentState(true);
    setAgentStateMessage(null);
    try {
      const result = await agentHostService.clearProjectState(activeProjectId);
      setAgentStateMessage({
        status: "success",
        message: `Cleared ${result.clearedRecords} saved record${result.clearedRecords === 1 ? "" : "s"}.`,
      });
    } catch (error: any) {
      setAgentStateMessage({
        status: "error",
        message: error?.message || String(error),
      });
    } finally {
      setIsClearingAgentState(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !aiApiKey.trim()) {
      onOpenChange(nextOpen);
      return;
    }
    void persistAiProviderSecret().then((saved) => {
      if (saved) onOpenChange(false);
    });
  };
  return {
    handleOpenChange,
    panelProps: {
      aiEnabled: aiEnabled,
      aiProvider: aiProvider,
      aiBaseUrl: aiBaseUrl,
      aiModel: aiModel,
      aiApiKey: aiApiKey,
      hasAiProviderSecret: hasAiProviderSecret,
      aiTimeoutMs: aiTimeoutMs,
      aiStreaming: aiStreaming,
      aiToolCalling: aiToolCalling,
      aiStructuredOutput: aiStructuredOutput,
      aiMaxInputTokens: aiMaxInputTokens,
      aiMaxOutputTokens: aiMaxOutputTokens,
      aiInlineCompletionProtocol: aiInlineCompletionProtocol,
      aiInlineCompletionModel: aiInlineCompletionModel,
      aiInlineBaseUrl: aiInlineBaseUrl,
      aiInlineApiKey: aiInlineApiKey,
      aiInlineTimeoutMs: aiInlineTimeoutMs,
      hasInlineProviderSecret: hasInlineProviderSecret,
      codexCliProfileId: codexCliProfileId,
      codexCliPath: codexCliPath,
      codexCliModel: codexCliModel,
      codexCliReasoningEffort: codexCliReasoningEffort,
      codexCliEnvironmentDraft: codexCliEnvironmentDraft,
      codeBuddyCliProfileId: codeBuddyCliProfileId,
      codeBuddyCliPath: codeBuddyCliPath,
      codeBuddyCliModel: codeBuddyCliModel,
      codeBuddyCliReasoningEffort: codeBuddyCliReasoningEffort,
      codeBuddyCliEnvironmentDraft: codeBuddyCliEnvironmentDraft,
      setAiEnabled: setAiEnabled,
      updateAiSettings: updateAiSettings,
      canTestAi: canTestAi,
      isTestingAi: isTestingAi,
      isSavingAiSecret: isSavingAiSecret,
      aiTestState: aiTestState,
      onTest: handleTestAiProvider,
      onPersistSecret: () => void persistAiProviderSecret(),
      onRemoveSecret: () => void removeAiProviderSecret(),
      onPersistInlineSecret: () => void persistInlineProviderSecret(),
      onRemoveInlineSecret: () => void removeInlineProviderSecret(),
      activeProjectName: activeProjectName,
      isClearingAgentState: isClearingAgentState,
      agentStateMessage: agentStateMessage,
      onClearAgentState: () => void clearCurrentProjectAgentState(),
    },
  };
}
