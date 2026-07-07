import { invokeWithInterceptors } from "./client";

export interface AiProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatCompletionRequest {
  config: AiProviderConfig;
  messages: AiChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiChatCompletionResult {
  content: string;
  model?: string;
}

export interface AiProviderTestResult {
  message: string;
  model: string;
}

export async function chatCompletion(
  request: AiChatCompletionRequest
): Promise<AiChatCompletionResult> {
  return invokeWithInterceptors<AiChatCompletionResult>("ai_chat_completion", {
    request,
  });
}

export async function testProvider(
  config: AiProviderConfig
): Promise<AiProviderTestResult> {
  return invokeWithInterceptors<AiProviderTestResult>("ai_test_provider", {
    config,
  });
}

export const aiService = {
  chatCompletion,
  testProvider,
};
