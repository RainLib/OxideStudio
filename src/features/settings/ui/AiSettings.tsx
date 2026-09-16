import { useAiCliSettings } from "@/features/settings/hooks/useAiCliSettings";
import { AiAssistantProviderSettingsSection } from "@/features/settings/ui/AiAssistantProviderSettingsSection";
import { AiInlineCompletionSettingsSection } from "@/features/settings/ui/AiInlineCompletionSettingsSection";
import { AiSafetyAndConversationSettingsSection } from "@/features/settings/ui/AiSafetyAndConversationSettingsSection";
import type { AiSettingsProps } from "@/features/settings/ui/aiSettingsTypes";
import { SettingsPanel } from "@/features/settings/ui/SettingsFields";

export function AiSettings({
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
  aiInlineCompletionProtocol,
  aiInlineCompletionModel,
  aiInlineBaseUrl,
  aiInlineApiKey,
  aiInlineTimeoutMs,
  hasInlineProviderSecret,
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
  settings,
  onUpdate,
  setAiEnabled,
  updateAiSettings,
  canTestAi,
  isTestingAi,
  isSavingAiSecret,
  aiTestState,
  onTest,
  onPersistSecret,
  onRemoveSecret,
  onPersistInlineSecret,
  onRemoveInlineSecret,
  activeProjectName,
  isClearingAgentState,
  agentStateMessage,
  onClearAgentState,
}: AiSettingsProps) {
  const {
    cliEnvironment,
    cliModels,
    cliEfforts,
    cliStatus,
    persistCliEnvironment,
    detectCli,
    refreshCliModels,
    selectCliExecutable,
    updateCliEnvironmentText,
  } = useAiCliSettings({
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
  });
  return (
    <SettingsPanel>
      <AiAssistantProviderSettingsSection
        aiEnabled={aiEnabled}
        aiProvider={aiProvider}
        aiBaseUrl={aiBaseUrl}
        aiModel={aiModel}
        aiApiKey={aiApiKey}
        hasAiProviderSecret={hasAiProviderSecret}
        aiTimeoutMs={aiTimeoutMs}
        aiStreaming={aiStreaming}
        aiToolCalling={aiToolCalling}
        aiStructuredOutput={aiStructuredOutput}
        aiMaxInputTokens={aiMaxInputTokens}
        aiMaxOutputTokens={aiMaxOutputTokens}
        codexCliPath={codexCliPath}
        codexCliModel={codexCliModel}
        codexCliReasoningEffort={codexCliReasoningEffort}
        codeBuddyCliPath={codeBuddyCliPath}
        codeBuddyCliModel={codeBuddyCliModel}
        codeBuddyCliReasoningEffort={codeBuddyCliReasoningEffort}
        setAiEnabled={setAiEnabled}
        updateAiSettings={updateAiSettings}
        canTestAi={canTestAi}
        isTestingAi={isTestingAi}
        isSavingAiSecret={isSavingAiSecret}
        aiTestState={aiTestState}
        onTest={onTest}
        onPersistSecret={onPersistSecret}
        onRemoveSecret={onRemoveSecret}
        cliEnvironment={cliEnvironment}
        cliModels={cliModels}
        cliEfforts={cliEfforts}
        cliStatus={cliStatus}
        persistCliEnvironment={persistCliEnvironment}
        detectCli={detectCli}
        refreshCliModels={refreshCliModels}
        selectCliExecutable={selectCliExecutable}
        updateCliEnvironmentText={updateCliEnvironmentText}
      />

      <AiInlineCompletionSettingsSection
        settings={settings}
        onUpdate={onUpdate}
        aiInlineCompletionProtocol={aiInlineCompletionProtocol}
        aiInlineCompletionModel={aiInlineCompletionModel}
        aiInlineBaseUrl={aiInlineBaseUrl}
        aiInlineApiKey={aiInlineApiKey}
        aiInlineTimeoutMs={aiInlineTimeoutMs}
        hasInlineProviderSecret={hasInlineProviderSecret}
        isSavingAiSecret={isSavingAiSecret}
        onPersistInlineSecret={onPersistInlineSecret}
        onRemoveInlineSecret={onRemoveInlineSecret}
        updateAiSettings={updateAiSettings}
      />

      <AiSafetyAndConversationSettingsSection
        settings={settings}
        activeProjectName={activeProjectName}
        isClearingAgentState={isClearingAgentState}
        agentStateMessage={agentStateMessage}
        onClearAgentState={onClearAgentState}
      />
    </SettingsPanel>
  );
}
