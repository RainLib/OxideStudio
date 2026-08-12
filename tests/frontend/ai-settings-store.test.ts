import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
  DEFAULT_CODEX_CLI_PROFILE_ID,
  migratePersistedAiSettings,
  useAiSettingsStore,
} from "@/store/useAiSettingsStore";

describe("AI settings provider channels", () => {
  beforeEach(() => {
    useAiSettingsStore.setState({
      enabled: true,
      provider: "openai-compatible",
      baseUrl: "https://assistant.example/v1",
      model: "assistant-model",
      inlineBaseUrl: "https://inline.example/v1",
      inlineCompletionModel: "inline-model",
      inlineCompletionProtocol: "text-completions-fim",
      codexCliProfileId: DEFAULT_CODEX_CLI_PROFILE_ID,
      codexCliPath: "codex",
      codexCliModel: "gpt-cli",
      codexCliReasoningEffort: "high",
      codexCliEnvironmentKeys: ["HTTPS_PROXY"],
    });
  });

  it("migrates a legacy HTTP profile into independent Assistant and inline defaults", () => {
    const migrated = migratePersistedAiSettings(
      {
        enabled: true,
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
      },
      1,
    );

    expect(migrated).toEqual(
      expect.objectContaining({
        provider: "openai-compatible",
        baseUrl: "https://legacy.example/v1",
        model: "legacy-model",
        inlineBaseUrl: "https://legacy.example/v1",
        inlineCompletionModel: "legacy-model",
        codexCliProfileId: DEFAULT_CODEX_CLI_PROFILE_ID,
        codeBuddyCliProfileId: DEFAULT_CODEBUDDY_CLI_PROFILE_ID,
      }),
    );
  });

  it("selecting Codex CLI leaves inline completion on its HTTP profile", () => {
    useAiSettingsStore.getState().updateSettings({ provider: "codex-cli" });

    expect(useAiSettingsStore.getState().assistantProviderConfig()).toEqual({
      kind: "codex-cli",
      profileId: DEFAULT_CODEX_CLI_PROFILE_ID,
      executablePath: "codex",
      model: "gpt-cli",
      reasoningEffort: "high",
      timeoutMs: useAiSettingsStore.getState().timeoutMs,
      environmentKeys: ["HTTPS_PROXY"],
    });
    expect(useAiSettingsStore.getState().inlineProviderConfig()).toEqual({
      kind: "openai-compatible",
      baseUrl: "https://inline.example/v1",
      model: "inline-model",
      timeoutMs: useAiSettingsStore.getState().inlineTimeoutMs,
    });
  });

  it("migrates and preserves an independent mode for each Assistant provider", () => {
    const migrated = migratePersistedAiSettings(
      { assistantMode: "plan" },
      2,
    );
    expect(migrated).toEqual(
      expect.objectContaining({
        assistantMode: "plan",
        codexCliAssistantMode: "plan",
        codeBuddyCliAssistantMode: "plan",
      }),
    );

    useAiSettingsStore.getState().updateSettings({
      assistantMode: "chat",
      codexCliAssistantMode: "agent",
      codeBuddyCliAssistantMode: "plan",
    });
    expect(useAiSettingsStore.getState()).toEqual(
      expect.objectContaining({
        assistantMode: "chat",
        codexCliAssistantMode: "agent",
        codeBuddyCliAssistantMode: "plan",
      }),
    );
  });
});
