export type AiProviderKind =
  | "openai-compatible"
  | "codex-cli"
  | "codebuddy-cli";

export type AiHttpProviderScope = "assistant" | "inline";

export interface AiHttpProviderConfig {
  kind: "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

/** Provider-advertised value; Codex and CodeBuddy may add levels independently. */
export type AiCliReasoningEffort = string;
export type AiCliServiceTier = "default" | "priority";
export type AiCliAccessMode = "restricted" | "full";

export interface AiCliModelServiceTier {
  id: string;
  name: string;
  description: string;
}

export interface AiCliProviderConfig {
  kind: "codex-cli" | "codebuddy-cli";
  profileId: string;
  executablePath?: string;
  model: string;
  reasoningEffort?: AiCliReasoningEffort;
  serviceTier?: AiCliServiceTier;
  accessMode?: AiCliAccessMode;
  timeoutMs?: number;
  /** Names only. Values are resolved by Rust from the private credential store. */
  environmentKeys?: string[];
}

export type AiProviderConfig = AiHttpProviderConfig | AiCliProviderConfig;

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatCompletionRequest {
  requestId?: string;
  config: AiHttpProviderConfig;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiChatCompletionResult {
  content: string;
  model?: string;
}

export type InlineCompletionProtocol =
  | "chat-completions"
  | "text-completions-fim";

export interface InlineLspContext {
  dialect?: string;
  clause?: string;
  statementRange?: unknown;
  ctes?: string[];
  referencedObjects?: string[];
  aliases?: Record<string, string>;
  expectedKinds?: string[];
  candidates?: Array<{
    label: string;
    insertText?: string;
    kind?: number;
    sortText?: string;
  }>;
  diagnostics?: Array<{ severity?: number; message: string }>;
  errorCount?: number;
  console?: {
    request: string;
    method?: string;
    path?: string;
    index?: string;
    area: string;
  };
}

export interface ProjectSnippet {
  relativePath: string;
  content: string;
}

export interface AiInlineCompletionRequest {
  requestId: string;
  protocol: InlineCompletionProtocol;
  config: AiHttpProviderConfig;
  prefix: string;
  suffix: string;
  languageId: string;
  dialect: string;
  filePath?: string;
  lspContext: InlineLspContext;
  relatedSnippets?: ProjectSnippet[];
}

export interface AiInlineCompletionResult {
  text: string;
  model?: string;
}

export interface AiProviderTestResult {
  message: string;
  model: string;
  executablePath?: string;
  version?: string;
  latencyMs?: number;
}

export interface AiCliDetectionResult {
  provider: "codex-cli" | "codebuddy-cli";
  available: boolean;
  executablePath?: string;
  version?: string;
  message: string;
}

export interface AiCliModelInfo {
  id: string;
  label: string;
  isDefault: boolean;
  /** Concrete provider default, kept separate from the `default` sentinel. */
  isProviderDefault?: boolean;
  reasoningEfforts?: string[];
  serviceTiers?: AiCliModelServiceTier[];
}

export interface AiCliCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

export interface AiCliCapabilityRequestOptions {
  /** Detected CLI version; participates in the persistent cache identity. */
  runtimeVersion?: string;
  /** Bypass renderer, persistent, and provider-process capability caches. */
  forceRefresh?: boolean;
}

export interface AiCliInstallResult {
  provider: "codex-cli" | "codebuddy-cli";
  executablePath: string;
  message: string;
}

export interface AiCliInstallationLaunchResult {
  provider: "codex-cli" | "codebuddy-cli";
  sessionId: string;
  message: string;
}

export type AiCliInstallationPhase =
  | "starting"
  | "downloading"
  | "installing"
  | "verifying"
  | "succeeded"
  | "failed";

export interface AiCliInstallationStatus {
  sessionId: string;
  provider: "codex-cli" | "codebuddy-cli";
  phase: AiCliInstallationPhase;
  message: string;
  result?: AiCliInstallResult;
}

export interface AiCliAuthenticationLaunchResult {
  provider: "codex-cli" | "codebuddy-cli";
  sessionId: string;
  message: string;
}

export interface AiCliAuthenticationMethod {
  id: string;
  name: string;
  description?: string;
}

export type AiCliAuthenticationPhase =
  | "starting"
  | "waiting-for-browser"
  | "waiting-for-callback"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface AiCliAuthenticationStatus {
  sessionId: string;
  provider: "codex-cli" | "codebuddy-cli";
  phase: AiCliAuthenticationPhase;
  message: string;
  methodId?: string;
  browserUrl?: string;
}
