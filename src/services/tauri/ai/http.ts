import { invokeWithInterceptors } from "../client";
import type { AiChatCompletionRequest, AiChatCompletionResult, AiHttpProviderScope, AiInlineCompletionRequest, AiInlineCompletionResult } from "./contracts";

export async function setProviderSecret(
  baseUrl: string,
  apiKey?: string,
  scope: AiHttpProviderScope = "assistant",
): Promise<boolean> {
  return invokeWithInterceptors<boolean>("ai_set_provider_secret", {
    request: { baseUrl, apiKey, scope },
  });
}

export async function hasProviderSecret(
  baseUrl: string,
  scope: AiHttpProviderScope = "assistant",
): Promise<boolean> {
  return invokeWithInterceptors<boolean>("ai_has_provider_secret", {
    baseUrl,
    scope,
  });
}

export async function setProviderHeaders(
  baseUrl: string,
  scope: AiHttpProviderScope,
  headers: Record<string, string>,
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("ai_set_provider_headers", {
    request: { baseUrl, scope, headers },
  });
}

export async function getProviderHeaders(
  baseUrl: string,
  scope: AiHttpProviderScope,
): Promise<Record<string, string>> {
  return invokeWithInterceptors<Record<string, string>>(
    "ai_get_provider_headers",
    { baseUrl, scope },
  );
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
