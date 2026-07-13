import {
  createModelAssistantPlanner,
  createModelToolResultSummarizer,
  type AssistantModelPlannerRequest,
  type AssistantModelPlannerResponse,
  type AssistantModelResultSummaryRequest,
  type AssistantModelResultSummaryResponse,
} from "./modelPlanner";
import { aiService, type AiProviderConfig } from "@/services/tauri/ai.service";

export function createOpenAiCompatibleAssistantPlanner(
  config: AiProviderConfig
) {
  return createModelAssistantPlanner({
    id: "openai-compatible-tool-planner",
    framework: "openai-compatible",
    invoke: async (request) =>
      parseModelJson<AssistantModelPlannerResponse>(
        (
          await aiService.chatCompletion({
            requestId: `${request.context.requestId}:plan`,
            config,
            messages: plannerMessages(request),
            temperature: 0,
            maxTokens: 1200,
          }, request.abortSignal)
        ).content
      ),
  });
}

export function createOpenAiCompatibleResultSummarizer(
  config: AiProviderConfig
) {
  return createModelToolResultSummarizer(async (request) =>
    parseModelJson<AssistantModelResultSummaryResponse>(
      (
        await aiService.chatCompletion({
          requestId: `${request.context.requestId}:summary`,
          config,
          messages: summaryMessages(request),
          temperature: 0,
          maxTokens: 800,
        }, request.abortSignal)
      ).content
    )
  );
}

function plannerMessages(request: AssistantModelPlannerRequest) {
  const { abortSignal: _abortSignal, ...modelRequest } = request;
  return [
    {
      role: "system" as const,
      content: [
        "You are OxideStudio's database assistant planner.",
        "Return only JSON with this shape: {\"intent\":\"workspace|metadata|query|explain|unknown\",\"steps\":[{\"id\":\"string\",\"title\":\"string\",\"toolName\":\"tool.name\",\"input\":{}}],\"warnings\":[\"string\"],\"notes\":[\"string\"]}.",
        "Choose toolName values only from manifest.tools. Do not invent tools.",
        "Never approve write, destructive, or external actions.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify(modelRequest, null, 2),
    },
  ];
}

function summaryMessages(request: AssistantModelResultSummaryRequest) {
  const { abortSignal: _abortSignal, ...modelRequest } = request;
  return [
    {
      role: "system" as const,
      content: [
        "You summarize OxideStudio assistant tool results.",
        "Return only JSON with this shape: {\"message\":\"string\",\"warnings\":[\"string\"],\"suggestedCalls\":[{\"id\":\"string\",\"toolName\":\"tool.name\",\"input\":{}}]}.",
        "Use only the supplied tool results. Do not invent rows, keys, documents, indexes, or schemas.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify(modelRequest, null, 2),
    },
  ];
}

export function parseModelJson<T>(content: string): T {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1] ?? trimmed;
  return JSON.parse(jsonText) as T;
}
