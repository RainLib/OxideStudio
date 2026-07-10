import type { AiProviderConfig } from "@/services/tauri/ai.service";
import type { AiPlannerKind } from "@/store/useAiSettingsStore";
import { createOfficialLangGraphAssistantPlanner } from "./langGraphPlanner";
import {
  createOpenAiCompatibleAssistantPlanner,
  createOpenAiCompatibleResultSummarizer,
} from "./openAiCompatiblePlanner";
import { createDefaultAssistantPlanner } from "./planner";
import type {
  AssistantPlanner,
  AssistantToolResultSummarizer,
} from "./types";

export type AssistantPlannerSelection = {
  planner?: AssistantPlanner;
  summarizeToolResults?: AssistantToolResultSummarizer;
  label: string;
  detail: string;
  configured: boolean;
};

export type AssistantPlannerSelectionInput = {
  enabled: boolean;
  plannerKind: AiPlannerKind;
  modelConfig: AiProviderConfig | null;
};

export function createAssistantPlannerSelection({
  enabled,
  plannerKind,
  modelConfig,
}: AssistantPlannerSelectionInput): AssistantPlannerSelection {
  const localPlanner = createDefaultAssistantPlanner();
  const modelPlanner =
    enabled && modelConfig
      ? createOpenAiCompatibleAssistantPlanner(modelConfig)
      : undefined;
  const summarizeToolResults =
    enabled && modelConfig
      ? createOpenAiCompatibleResultSummarizer(modelConfig)
      : undefined;

  if (plannerKind === "local" || !enabled) {
    return {
      planner: localPlanner,
      summarizeToolResults: undefined,
      label: "Local planner",
      detail: "Deterministic planning, no model provider",
      configured: true,
    };
  }

  if (plannerKind === "langgraph") {
    return {
      planner: createOfficialLangGraphAssistantPlanner({
        primaryPlanner: modelPlanner,
        fallbackPlanner: localPlanner,
      }),
      summarizeToolResults,
      label: modelConfig ? "LangGraph planner" : "LangGraph planner (local fallback)",
      detail: modelConfig
        ? `${modelConfig.model} through @langchain/langgraph`
        : "Model provider missing; graph falls back to local rules",
      configured: Boolean(modelConfig),
    };
  }

  return {
    planner: modelPlanner ?? localPlanner,
    summarizeToolResults,
    label: modelConfig ? "Model planner" : "Model planner (local fallback)",
    detail: modelConfig
      ? modelConfig.model
      : "Enable provider settings to use model planning",
    configured: Boolean(modelConfig),
  };
}
