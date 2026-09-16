import { ProviderHeadersEditor } from "@/features/settings/ui/ProviderHeadersEditor";
import {
  CheckboxLabel,
  NumberInput,
  selectClass,
  SettingRow,
  SettingsButton,
  SettingsDivider,
  SettingsInput,
} from "@/features/settings/ui/SettingsFields";
import type {
  AiSettingsProps,
  UpdateAiSettings,
} from "@/features/settings/ui/aiSettingsTypes";
import { cn } from "@/lib/utils";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";

type AiAssistantProviderSettingsSectionProps = Pick<
  AiSettingsProps,
  | "aiEnabled"
  | "aiProvider"
  | "aiBaseUrl"
  | "aiModel"
  | "aiApiKey"
  | "hasAiProviderSecret"
  | "aiTimeoutMs"
  | "aiStreaming"
  | "aiToolCalling"
  | "aiStructuredOutput"
  | "aiMaxInputTokens"
  | "aiMaxOutputTokens"
  | "codexCliPath"
  | "codexCliModel"
  | "codexCliReasoningEffort"
  | "codeBuddyCliPath"
  | "codeBuddyCliModel"
  | "codeBuddyCliReasoningEffort"
  | "setAiEnabled"
  | "canTestAi"
  | "isTestingAi"
  | "isSavingAiSecret"
  | "aiTestState"
  | "onTest"
  | "onPersistSecret"
  | "onRemoveSecret"
> & {
  updateAiSettings: UpdateAiSettings;
  cliEnvironment: Record<string, string>;
  cliModels: AiCliModelInfo[];
  cliEfforts: string[];
  cliStatus: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
  };
  persistCliEnvironment: () => Promise<void>;
  detectCli: () => Promise<void>;
  refreshCliModels: () => Promise<void>;
  selectCliExecutable: () => Promise<void>;
  updateCliEnvironmentText: (value: string) => void;
};

/** Assistant provider credentials, CLI controls, model capability, and test UI. */
export function AiAssistantProviderSettingsSection({
  aiEnabled,
  aiProvider,
  aiBaseUrl,
  aiModel,
  aiApiKey,
  hasAiProviderSecret,
  aiTimeoutMs,
  aiStreaming,
  aiToolCalling,
  aiStructuredOutput,
  aiMaxInputTokens,
  aiMaxOutputTokens,
  codexCliPath,
  codexCliModel,
  codexCliReasoningEffort,
  codeBuddyCliPath,
  codeBuddyCliModel,
  codeBuddyCliReasoningEffort,
  setAiEnabled,
  updateAiSettings,
  canTestAi,
  isTestingAi,
  isSavingAiSecret,
  aiTestState,
  onTest,
  onPersistSecret,
  onRemoveSecret,
  cliEnvironment,
  cliModels,
  cliEfforts,
  cliStatus,
  persistCliEnvironment,
  detectCli,
  refreshCliModels,
  selectCliExecutable,
  updateCliEnvironmentText,
}: AiAssistantProviderSettingsSectionProps) {
  return (
    <>
      <SettingsDivider title="Provider" first />
      <CheckboxLabel
        label="Enable AI assistant"
        checked={aiEnabled}
        onChange={() => setAiEnabled(!aiEnabled)}
        detail="Disabled mode skips the AI runtime and keeps the database workbench available."
      />
      <p className="mb-3 max-w-[68ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Choose O2, Plan, Agent, or Chat from the assistant composer. Planning
        and tool orchestration are selected automatically for the active mode.
      </p>
      <SettingRow label="Provider:">
        <select
          className={selectClass}
          value={aiProvider}
          onChange={(event) =>
            updateAiSettings({
              provider: event.target.value as
                | "openai-compatible"
                | "codex-cli"
                | "codebuddy-cli",
            })
          }
        >
          <option value="openai-compatible">OpenAI compatible</option>
          <option value="codex-cli">Codex CLI (no API key)</option>
          <option value="codebuddy-cli">CodeBuddy Code CLI (no API key)</option>
        </select>
      </SettingRow>
      {aiProvider === "openai-compatible" ? (
        <>
          <SettingRow label="Base URL:">
            <div>
              <SettingsInput
                value={aiBaseUrl}
                onChange={(value) => updateAiSettings({ baseUrl: value })}
                placeholder="https://api.openai.com/v1"
              />
              <p className="mt-1 text-[11px] text-[hsl(var(--wb-text-muted))]">
                Include the API version path required by your provider, usually
                /v1.
              </p>
            </div>
          </SettingRow>
          <SettingRow label="Model:">
            <SettingsInput
              value={aiModel}
              onChange={(value) => updateAiSettings({ model: value })}
              placeholder="gpt-4.1-mini"
            />
          </SettingRow>
          <SettingRow label="API Key:">
            <div className="flex items-center gap-2">
              <SettingsInput
                type="password"
                value={aiApiKey}
                onChange={(value) => updateAiSettings({ apiKey: value })}
                onBlur={onPersistSecret}
                placeholder={
                  hasAiProviderSecret
                    ? "Stored in local credential file"
                    : "sk-..."
                }
              />
              {aiApiKey.trim() && (
                <SettingsButton
                  onClick={onPersistSecret}
                  disabled={isSavingAiSecret}
                >
                  {isSavingAiSecret ? "Saving..." : "Save"}
                </SettingsButton>
              )}
              {hasAiProviderSecret && (
                <SettingsButton onClick={onRemoveSecret}>Remove</SettingsButton>
              )}
            </div>
          </SettingRow>
          <p className="-mt-1 mb-3 ml-[148px] max-w-[68ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
            Stored only in OxideStudio's per-user configuration directory, never
            in the project or browser storage. The credential file is restricted
            to the current OS user.
          </p>
          <ProviderHeadersEditor baseUrl={aiBaseUrl} scope="assistant" />
        </>
      ) : (
        <>
          <SettingRow label="Executable:">
            <div className="flex items-center gap-2">
              <SettingsInput
                value={
                  aiProvider === "codex-cli" ? codexCliPath : codeBuddyCliPath
                }
                onChange={(value) =>
                  updateAiSettings(
                    aiProvider === "codex-cli"
                      ? { codexCliPath: value }
                      : { codeBuddyCliPath: value },
                  )
                }
                placeholder={
                  aiProvider === "codex-cli"
                    ? "Auto-detect codex"
                    : "Auto-detect codebuddy or cbc"
                }
              />
              <SettingsButton onClick={() => void selectCliExecutable()}>
                Browse…
              </SettingsButton>
              <SettingsButton
                onClick={() => void detectCli()}
                disabled={cliStatus.status === "loading"}
              >
                Detect
              </SettingsButton>
            </div>
          </SettingRow>
          <SettingRow label="Model:">
            <div className="flex items-center gap-2">
              {cliModels.length ? (
                <select
                  className={selectClass}
                  value={
                    aiProvider === "codex-cli"
                      ? codexCliModel
                      : codeBuddyCliModel
                  }
                  onChange={(event) =>
                    updateAiSettings(
                      aiProvider === "codex-cli"
                        ? { codexCliModel: event.target.value }
                        : { codeBuddyCliModel: event.target.value },
                    )
                  }
                >
                  {cliModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              ) : (
                <SettingsInput
                  value={
                    aiProvider === "codex-cli"
                      ? codexCliModel
                      : codeBuddyCliModel
                  }
                  onChange={(value) =>
                    updateAiSettings(
                      aiProvider === "codex-cli"
                        ? { codexCliModel: value }
                        : { codeBuddyCliModel: value },
                    )
                  }
                  placeholder="default"
                />
              )}
              <SettingsButton
                onClick={() => void refreshCliModels()}
                disabled={cliStatus.status === "loading"}
              >
                Refresh
              </SettingsButton>
            </div>
          </SettingRow>
          <SettingRow label="Reasoning:">
            <select
              className={selectClass}
              value={
                aiProvider === "codex-cli"
                  ? codexCliReasoningEffort
                  : codeBuddyCliReasoningEffort
              }
              onChange={(event) =>
                updateAiSettings(
                  aiProvider === "codex-cli"
                    ? {
                        codexCliReasoningEffort: event.target.value,
                      }
                    : {
                        codeBuddyCliReasoningEffort: event.target.value,
                      },
                )
              }
            >
              <option value="default">Provider default</option>
              {(cliEfforts.length
                ? cliEfforts
                : ["low", "medium", "high", "xhigh"]
              )
                .filter((effort) => effort !== "default")
                .map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
            </select>
          </SettingRow>
          <SettingRow label="Environment:">
            <div>
              <textarea
                className="min-h-24 w-full resize-y rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 py-1.5 font-mono text-[11px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]"
                value={Object.entries(cliEnvironment)
                  .map(([name, value]) => `${name}=${value}`)
                  .join("\n")}
                onChange={(event) =>
                  updateCliEnvironmentText(event.target.value)
                }
                onBlur={() => void persistCliEnvironment()}
                placeholder="HTTPS_PROXY=http://127.0.0.1:7890"
              />
              <p className="mt-1 text-[11px] text-[hsl(var(--wb-text-muted))]">
                Values are stored only in the private Rust credential store.
                OXIDE_* and internal bridge variables are reserved.
              </p>
            </div>
          </SettingRow>
          {cliStatus.message && (
            <p
              className={cn(
                "mb-2 ml-[148px] text-[11px]",
                cliStatus.status === "error"
                  ? "text-[hsl(var(--destructive))]"
                  : "text-[hsl(var(--wb-text-muted))]",
              )}
            >
              {cliStatus.message}
            </p>
          )}
        </>
      )}
      <SettingRow label="Timeout ms:">
        <NumberInput
          value={aiTimeoutMs}
          min={1000}
          max={120000}
          step={1000}
          onChange={(timeoutMs) => updateAiSettings({ timeoutMs })}
        />
      </SettingRow>
      <SettingRow label="Input tokens:">
        <NumberInput
          value={aiMaxInputTokens}
          min={8_192}
          max={2_000_000}
          step={4_096}
          onChange={(maxInputTokens) => updateAiSettings({ maxInputTokens })}
        />
      </SettingRow>
      <SettingRow label="Output tokens:">
        <NumberInput
          value={aiMaxOutputTokens}
          min={256}
          max={128_000}
          step={256}
          onChange={(maxOutputTokens) => updateAiSettings({ maxOutputTokens })}
        />
      </SettingRow>
      {aiProvider === "openai-compatible" && (
        <>
          <CheckboxLabel
            label="Model supports streaming"
            checked={aiStreaming}
            onChange={() => updateAiSettings({ streaming: !aiStreaming })}
          />
          <CheckboxLabel
            label="Model supports tool calling"
            checked={aiToolCalling}
            onChange={() => updateAiSettings({ toolCalling: !aiToolCalling })}
          />
          <CheckboxLabel
            label="Model supports structured output"
            checked={aiStructuredOutput}
            onChange={() =>
              updateAiSettings({ structuredOutput: !aiStructuredOutput })
            }
          />
        </>
      )}

      <div className="mt-4 flex items-center gap-3">
        <SettingsButton onClick={onTest} disabled={!canTestAi || isTestingAi}>
          {isTestingAi ? "Testing..." : "Test Provider"}
        </SettingsButton>
        {aiTestState && (
          <span
            className={cn(
              "text-[12px]",
              aiTestState.status === "success"
                ? "text-emerald-400"
                : "text-[hsl(var(--destructive))]",
            )}
          >
            {aiTestState.message}
          </span>
        )}
      </div>

    </>
  );
}
