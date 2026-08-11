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

export type AiCliReasoningEffort =
  | "default"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export interface AiCliProviderConfig {
  kind: "codex-cli" | "codebuddy-cli";
  profileId: string;
  executablePath?: string;
  model: string;
  reasoningEffort?: AiCliReasoningEffort;
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
  reasoningEfforts?: string[];
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
): Promise<AiCliModelInfo[]> {
  return invokeWithInterceptors<AiCliModelInfo[]>("ai_cli_list_models", {
    config,
  });
}

export async function listCliEfforts(
  config: AiCliProviderConfig,
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("ai_cli_list_efforts", { config });
}

export async function setCliEnvironment(
  provider: AiCliProviderConfig["kind"],
  profileId: string,
  environment: Record<string, string>,
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("ai_cli_set_environment", {
    request: { provider, profileId, environment },
  });
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
  setCliEnvironment,
  getCliEnvironment,
  setProviderSecret,
  hasProviderSecret,
};
