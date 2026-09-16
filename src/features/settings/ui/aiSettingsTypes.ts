import type { AppSettings } from "@/lib/appSettings";
import type { AiCliReasoningEffort } from "@/services/tauri/ai.service";

export type AiSettingsProvider =
  | "openai-compatible"
  | "codex-cli"
  | "codebuddy-cli";

export type UpdateAiSettings = (
  settings: Partial<{
    provider: AiSettingsProvider;
    baseUrl: string;
    model: string;
    apiKey: string;
    timeoutMs: number;
    streaming: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
    maxInputTokens: number;
    maxOutputTokens: number;
    inlineCompletionProtocol: "chat-completions" | "text-completions-fim";
    inlineCompletionModel: string;
    inlineBaseUrl: string;
    inlineApiKey: string;
    inlineTimeoutMs: number;
    codexCliPath: string;
    codexCliModel: string;
    codexCliReasoningEffort: AiCliReasoningEffort;
    codexCliEnvironmentKeys: string[];
    codexCliEnvironmentDraft: Record<string, string>;
    codeBuddyCliPath: string;
    codeBuddyCliModel: string;
    codeBuddyCliReasoningEffort: AiCliReasoningEffort;
    codeBuddyCliEnvironmentKeys: string[];
    codeBuddyCliEnvironmentDraft: Record<string, string>;
  }>,
) => void;

export interface AiSettingsProps {
  aiEnabled: boolean;
  aiProvider: AiSettingsProvider;
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
  hasAiProviderSecret: boolean;
  aiTimeoutMs: number;
  aiStreaming: boolean;
  aiToolCalling: boolean;
  aiStructuredOutput: boolean;
  aiMaxInputTokens: number;
  aiMaxOutputTokens: number;
  aiInlineCompletionProtocol: "chat-completions" | "text-completions-fim";
  aiInlineCompletionModel: string;
  aiInlineBaseUrl: string;
  aiInlineApiKey: string;
  aiInlineTimeoutMs: number;
  hasInlineProviderSecret: boolean;
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
  settings: AppSettings;
  onUpdate: (updates: Partial<AppSettings>) => void;
  setAiEnabled: (enabled: boolean) => void;
  updateAiSettings: UpdateAiSettings;
  canTestAi: boolean;
  isTestingAi: boolean;
  isSavingAiSecret: boolean;
  aiTestState: { status: "success" | "error"; message: string } | null;
  onTest: () => void;
  onPersistSecret: () => void;
  onRemoveSecret: () => void;
  onPersistInlineSecret: () => void;
  onRemoveInlineSecret: () => void;
  activeProjectName: string;
  isClearingAgentState: boolean;
  agentStateMessage: { status: "success" | "error"; message: string } | null;
  onClearAgentState: () => void;
}
