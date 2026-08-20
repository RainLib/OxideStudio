import { invokeWithInterceptors } from "./client";

export type AiProviderKind =
  | "openai-compatible"
  | "codex-cli"
  | "codebuddy-cli";

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
}

export async function setProviderSecret(
  baseUrl: string,
  apiKey?: string,
): Promise<boolean> {
  return invokeWithInterceptors<boolean>("ai_set_provider_secret", {
    request: { baseUrl, apiKey },
  });
}

export async function hasProviderSecret(baseUrl: string): Promise<boolean> {
  return invokeWithInterceptors<boolean>("ai_has_provider_secret", { baseUrl });
}

export async function chatCompletion(
  request: AiChatCompletionRequest,
  abortSignal?: AbortSignal
): Promise<AiChatCompletionResult> {
  if (abortSignal?.aborted) throw abortError();
  const requestId = request.requestId || createAiRequestId();
  const cancel = () => {
    void cancelRequest(requestId).catch(() => undefined);
  };
  abortSignal?.addEventListener("abort", cancel, { once: true });
  try {
    return await invokeWithInterceptors<AiChatCompletionResult>(
      "ai_chat_completion",
      {
        request: { ...request, requestId },
      }
    );
  } finally {
    abortSignal?.removeEventListener("abort", cancel);
  }
}

export async function cancelRequest(requestId: string): Promise<boolean> {
  return invokeWithInterceptors<boolean>("cancel_ai_request", { requestId });
}

export async function inlineCompletion(
  request: AiInlineCompletionRequest,
  abortSignal?: AbortSignal
): Promise<AiInlineCompletionResult> {
  if (abortSignal?.aborted) throw abortError();
  const cancel = () => {
    void cancelRequest(request.requestId).catch(() => undefined);
  };
  abortSignal?.addEventListener("abort", cancel, { once: true });
  try {
    return await invokeWithInterceptors<AiInlineCompletionResult>(
      "ai_inline_completion",
      { request }
    );
  } finally {
    abortSignal?.removeEventListener("abort", cancel);
  }
}

function createAiRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ai-${crypto.randomUUID()}`;
  }
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function abortError() {
  const error = new Error("AI request cancelled");
  error.name = "AbortError";
  return error;
}

export async function testProvider(
  config: AiProviderConfig
): Promise<AiProviderTestResult> {
  if (config.kind !== "openai-compatible") {
    return invokeWithInterceptors<AiProviderTestResult>(
      "ai_cli_test_provider",
      { config },
    );
  }
  return invokeWithInterceptors<AiProviderTestResult>("ai_test_provider", {
    config,
  });
}

export async function detectCliProvider(
  config: AiCliProviderConfig,
): Promise<AiCliDetectionResult> {
  return invokeWithInterceptors<AiCliDetectionResult>("ai_cli_detect", {
    config,
  });
}

export async function listCliModels(
  config: AiCliProviderConfig,
  options: AiCliCapabilityRequestOptions = {},
): Promise<AiCliModelInfo[]> {
  return invokeWithInterceptors<AiCliModelInfo[]>("ai_cli_list_models", {
    config,
    runtimeVersion: options.runtimeVersion,
    forceRefresh: options.forceRefresh,
  });
}

export async function listCliEfforts(
  config: AiCliProviderConfig,
  options: AiCliCapabilityRequestOptions = {},
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("ai_cli_list_efforts", {
    config,
    runtimeVersion: options.runtimeVersion,
    forceRefresh: options.forceRefresh,
  });
}

export async function listCliCommands(
  config: AiCliProviderConfig,
  options: AiCliCapabilityRequestOptions = {},
): Promise<AiCliCommandInfo[]> {
  return invokeWithInterceptors<AiCliCommandInfo[]>("ai_cli_list_commands", {
    config,
    runtimeVersion: options.runtimeVersion,
    forceRefresh: options.forceRefresh,
  });
}

export async function beginCliInstallation(
  provider: AiCliProviderConfig["kind"],
): Promise<AiCliInstallationLaunchResult> {
  return invokeWithInterceptors<AiCliInstallationLaunchResult>(
    "ai_cli_install_provider",
    { provider },
  );
}

export async function getCliInstallationStatus(
  sessionId: string,
): Promise<AiCliInstallationStatus> {
  return invokeWithInterceptors<AiCliInstallationStatus>(
    "ai_cli_installation_status",
    { sessionId },
  );
}

export async function beginCliAuthentication(
  config: AiCliProviderConfig,
  methodId?: string,
): Promise<AiCliAuthenticationLaunchResult> {
  return invokeWithInterceptors<AiCliAuthenticationLaunchResult>(
    "ai_cli_begin_authentication",
    { config, methodId },
  );
}

export async function listCliAuthenticationMethods(
  config: AiCliProviderConfig,
): Promise<AiCliAuthenticationMethod[]> {
  return invokeWithInterceptors<AiCliAuthenticationMethod[]>(
    "ai_cli_list_authentication_methods",
    { config },
  );
}

export async function getCliAuthenticationStatus(
  sessionId: string,
): Promise<AiCliAuthenticationStatus> {
  return invokeWithInterceptors<AiCliAuthenticationStatus>(
    "ai_cli_authentication_status",
    { sessionId },
  );
}

export async function cancelCliAuthentication(
  sessionId: string,
): Promise<AiCliAuthenticationStatus> {
  return invokeWithInterceptors<AiCliAuthenticationStatus>(
    "ai_cli_cancel_authentication",
    { sessionId },
  );
}

export async function setCliEnvironment(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
  environment: Record<string, string>,
): Promise<string[]> {
  const result = await invokeWithInterceptors<{
    keys: string[];
    revision: string;
  }>("ai_cli_set_environment", {
    request: { provider, profileId, environment },
  });
  cliEnvironmentRevisions.set(
    `${provider}\u0000${profileId}`,
    result.revision,
  );
  notifyCliEnvironmentRevision(provider, profileId);
  return result.keys;
}

const cliEnvironmentRevisions = new Map<string, string>();
const cliEnvironmentRevisionListeners = new Set<
  (provider: AiCliProviderConfig["kind"], profileId: string) => void
>();

function notifyCliEnvironmentRevision(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
) {
  for (const listener of cliEnvironmentRevisionListeners) {
    listener(provider, profileId);
  }
}

export function getCliEnvironmentRevision(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
) {
  return cliEnvironmentRevisions.get(`${provider}\u0000${profileId}`) ?? "";
}

/**
 * A revision is intentionally opaque: it tells the renderer that a private
 * CLI environment changed without exposing a value or deriving a secret hash.
 */
export function subscribeCliEnvironmentRevision(
  listener: (provider: AiCliProviderConfig["kind"], profileId: string) => void,
) {
  cliEnvironmentRevisionListeners.add(listener);
  return () => cliEnvironmentRevisionListeners.delete(listener);
}

export async function getCliEnvironment(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
): Promise<Record<string, string>> {
  return invokeWithInterceptors<Record<string, string>>(
    "ai_cli_get_environment",
    { request: { provider, profileId } },
  );
}

export const aiService = {
  chatCompletion,
  inlineCompletion,
  cancelRequest,
  testProvider,
  detectCliProvider,
  listCliModels,
  listCliEfforts,
  listCliCommands,
  beginCliInstallation,
  getCliInstallationStatus,
  listCliAuthenticationMethods,
  beginCliAuthentication,
  getCliAuthenticationStatus,
  cancelCliAuthentication,
  setCliEnvironment,
  getCliEnvironment,
  getCliEnvironmentRevision,
  subscribeCliEnvironmentRevision,
  setProviderSecret,
  hasProviderSecret,
};
