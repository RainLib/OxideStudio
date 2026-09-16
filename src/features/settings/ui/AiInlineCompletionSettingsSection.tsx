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
import type { AppSettings } from "@/lib/appSettings";

interface AiInlineCompletionSettingsSectionProps {
  settings: AppSettings;
  onUpdate: AiSettingsProps["onUpdate"];
  aiInlineCompletionProtocol: AiSettingsProps["aiInlineCompletionProtocol"];
  aiInlineCompletionModel: string;
  aiInlineBaseUrl: string;
  aiInlineApiKey: string;
  aiInlineTimeoutMs: number;
  hasInlineProviderSecret: boolean;
  isSavingAiSecret: boolean;
  onPersistInlineSecret: () => void;
  onRemoveInlineSecret: () => void;
  updateAiSettings: UpdateAiSettings;
}

/** Inline-completion transport, prompt scope, and credential preferences. */
export function AiInlineCompletionSettingsSection({
  settings,
  onUpdate,
  aiInlineCompletionProtocol,
  aiInlineCompletionModel,
  aiInlineBaseUrl,
  aiInlineApiKey,
  aiInlineTimeoutMs,
  hasInlineProviderSecret,
  isSavingAiSecret,
  onPersistInlineSecret,
  onRemoveInlineSecret,
  updateAiSettings,
}: AiInlineCompletionSettingsSectionProps) {
  const inlineCompletion = settings.editor.inlineCompletion;
  const updateInlineCompletion = (
    patch: Partial<AppSettings["editor"]["inlineCompletion"]>,
  ) =>
    onUpdate({
      editor: {
        ...settings.editor,
        inlineCompletion: { ...inlineCompletion, ...patch },
      },
    });

  return (
    <>
      <SettingsDivider title="Inline Completion" />
      <CheckboxLabel
        label="Enable inline completion"
        detail="Show database-aware ghost text without executing generated SQL"
        checked={inlineCompletion.enabled}
        onChange={() =>
          updateInlineCompletion({ enabled: !inlineCompletion.enabled })
        }
      />
      <CheckboxLabel
        label="Automatic suggestions"
        checked={inlineCompletion.automaticSuggestions}
        onChange={() =>
          updateInlineCompletion({
            automaticSuggestions: !inlineCompletion.automaticSuggestions,
          })
        }
      />
      <CheckboxLabel
        label="Include schema metadata"
        checked={inlineCompletion.includeSchemaMetadata}
        onChange={() =>
          updateInlineCompletion({
            includeSchemaMetadata: !inlineCompletion.includeSchemaMetadata,
          })
        }
      />
      <CheckboxLabel
        label="Include project context"
        detail="Opt in to sending relevant database-file snippets from the associated project"
        checked={inlineCompletion.includeProjectContext}
        onChange={() =>
          updateInlineCompletion({
            includeProjectContext: !inlineCompletion.includeProjectContext,
          })
        }
      />
      <SettingRow label="Base URL:">
        <SettingsInput
          value={aiInlineBaseUrl}
          onChange={(inlineBaseUrl) => updateAiSettings({ inlineBaseUrl })}
          placeholder="https://api.openai.com/v1"
        />
      </SettingRow>
      <SettingRow label="API Key:">
        <div className="flex items-center gap-2">
          <SettingsInput
            type="password"
            value={aiInlineApiKey}
            onChange={(inlineApiKey) => updateAiSettings({ inlineApiKey })}
            onBlur={onPersistInlineSecret}
            placeholder={
              hasInlineProviderSecret
                ? "Stored in local credential file"
                : "sk-..."
            }
          />
          {aiInlineApiKey.trim() && (
            <SettingsButton
              onClick={onPersistInlineSecret}
              disabled={isSavingAiSecret}
            >
              Save
            </SettingsButton>
          )}
          {hasInlineProviderSecret && (
            <SettingsButton onClick={onRemoveInlineSecret}>Remove</SettingsButton>
          )}
        </div>
      </SettingRow>
      <ProviderHeadersEditor baseUrl={aiInlineBaseUrl} scope="inline" />
      <SettingRow label="Timeout ms:">
        <NumberInput
          value={aiInlineTimeoutMs}
          min={1_000}
          max={15_000}
          step={500}
          onChange={(inlineTimeoutMs) => updateAiSettings({ inlineTimeoutMs })}
        />
      </SettingRow>
      <SettingRow label="Protocol:">
        <select
          className={selectClass}
          value={aiInlineCompletionProtocol}
          onChange={(event) =>
            updateAiSettings({
              inlineCompletionProtocol: event.target.value as
                | "chat-completions"
                | "text-completions-fim",
            })
          }
        >
          <option value="chat-completions">Chat completions</option>
          <option value="text-completions-fim">Text completions (FIM)</option>
        </select>
      </SettingRow>
      <SettingRow label="Completion model:">
        <SettingsInput
          value={aiInlineCompletionModel}
          onChange={(inlineCompletionModel) =>
            updateAiSettings({ inlineCompletionModel })
          }
          placeholder="Low-latency completion model"
        />
      </SettingRow>
      <p className="mt-2 max-w-[68ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Inline completion uses its own HTTP provider, independently of the CLI
        assistant. Requests use the timeout above (1–15 seconds) and never
        include connection strings, API keys, query results, or database row
        data in the prompt.
      </p>
    </>
  );
}
