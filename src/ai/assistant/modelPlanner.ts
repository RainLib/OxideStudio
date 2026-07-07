import {
  createAiToolManifest,
  type AiToolManifest,
} from "@/ai/tools/manifest";
import {
  evaluateAiToolPolicy,
} from "@/ai/tools/policy";
import type { AiToolExecutionContext } from "@/ai/tools/types";
import { classifyAssistantIntent, createDefaultAssistantPlanner } from "./planner";
import type {
  AssistantIntent,
  AssistantPlanner,
  AssistantPlannerInput,
  AssistantPlannerResult,
  AssistantPlanStep,
  AssistantToolCallResult,
  AssistantToolResultSummarizer,
  AssistantToolResultSummary,
  AssistantTurnInput,
} from "./types";

export type AssistantModelPlannerRequest = {
  turn: AssistantTurnInput;
  context: AssistantModelPlannerContext;
  manifest: AiToolManifest;
  instructions: string[];
};

export type AssistantModelPlannerContext = Pick<
  AiToolExecutionContext,
  "requestId" | "activeConnectionId" | "activeDriver" | "activeNamespace" | "activeTab"
>;

export type AssistantModelPlanStep = {
  id?: string;
  title?: string;
  toolName?: string;
  input?: Record<string, unknown>;
};

export type AssistantModelPlannerResponse = {
  intent?: AssistantIntent;
  steps?: AssistantModelPlanStep[];
  warnings?: string[];
  notes?: string[];
};

export type AssistantModelResultSummaryRequest = {
  turn: AssistantTurnInput;
  context: AssistantModelPlannerRequest["context"];
  manifest: AiToolManifest;
  results: AssistantToolCallResult[];
  instructions: string[];
};

export type AssistantModelResultSummaryResponse = AssistantToolResultSummary;

export type AssistantModelPlannerInvoke = (
  request: AssistantModelPlannerRequest
) => AssistantModelPlannerResponse | Promise<AssistantModelPlannerResponse>;

export type AssistantModelResultSummarizerInvoke = (
  request: AssistantModelResultSummaryRequest
) =>
  | AssistantModelResultSummaryResponse
  | Promise<AssistantModelResultSummaryResponse>;

export type ModelAssistantPlannerOptions = {
  id?: string;
  description?: string;
  framework?: string;
  invoke: AssistantModelPlannerInvoke;
  fallback?: AssistantPlanner | false;
};

export class ModelAssistantPlanner implements AssistantPlanner {
  readonly id: string;
  readonly mode = "model" as const;
  readonly description: string;
  readonly framework?: string;

  private readonly invoke: AssistantModelPlannerInvoke;
  private readonly fallback?: AssistantPlanner | false;

  constructor(options: ModelAssistantPlannerOptions) {
    this.id = options.id || "model-tool-planner";
    this.description =
      options.description ||
      "Provider-neutral planner that asks a model to choose AI tool calls from the shared manifest.";
    this.framework = options.framework;
    this.invoke = options.invoke;
    this.fallback = options.fallback ?? createDefaultAssistantPlanner();
  }

  async plan(input: AssistantPlannerInput): Promise<AssistantPlannerResult> {
    let response: AssistantModelPlannerResponse;
    try {
      response = await this.invoke({
        turn: modelPlannerTurn(input.turn),
        context: modelPlannerContext(input.context),
        manifest: createAiToolManifest(input.availableTools, input.policy),
        instructions: MODEL_PLANNER_INSTRUCTIONS,
      });
    } catch (error: any) {
      if (!this.fallback) {
        throw error;
      }

      const fallback = await this.fallback.plan(input);
      return {
        ...fallback,
        warnings: [
          ...(fallback.warnings ?? []),
          `Model planner failed; used fallback planner: ${error?.message || String(error)}`,
        ],
      };
    }

    const warnings: string[] = [...(response.warnings ?? [])];
    const steps = this.toPlanSteps(input, response.steps ?? [], warnings);

    if (steps.length === 0 && this.fallback) {
      const fallback = await this.fallback.plan(input);
      return {
        ...fallback,
        warnings: [...(fallback.warnings ?? []), ...warnings],
        notes: [
          ...(fallback.notes ?? []),
          "Model planner returned no executable steps; used fallback planner.",
          ...(response.notes ?? []),
        ],
      };
    }

    return {
      intent: response.intent || classifyAssistantIntent(input.turn),
      steps,
      warnings,
      notes: response.notes ?? [],
    };
  }

  private toPlanSteps(
    input: AssistantPlannerInput,
    steps: AssistantModelPlanStep[],
    warnings: string[]
  ): AssistantPlanStep[] {
    const toolsByName = new Map(
      input.availableTools.map((tool) => [tool.name, tool])
    );

    return steps.flatMap((step, index): AssistantPlanStep[] => {
      if (!step.toolName) {
        return [
          {
            id: step.id || `model-note-${index + 1}`,
            title: step.title || "Model planning note",
            input: step.input,
            requiresApproval: false,
          },
        ];
      }

      const tool = toolsByName.get(step.toolName);
      if (!tool) {
        warnings.push(`Model planner requested unknown tool: ${step.toolName}`);
        return [];
      }

      const decision = evaluateAiToolPolicy(tool, input.policy);
      return [
        {
          id: step.id || `model-tool-${index + 1}`,
          title: step.title || tool.description || step.toolName,
          toolName: step.toolName,
          input: step.input || {},
          requiresApproval: decision.requiresApproval,
        },
      ];
    });
  }
}

export function createModelAssistantPlanner(
  options: ModelAssistantPlannerOptions
) {
  return new ModelAssistantPlanner(options);
}

export function createModelToolResultSummarizer(
  invoke: AssistantModelResultSummarizerInvoke
): AssistantToolResultSummarizer {
  return async (input) =>
    invoke({
      turn: modelPlannerTurn(input.turn),
      context: modelPlannerContext(input.context),
      manifest: createAiToolManifest(input.availableTools, input.policy),
      results: input.results,
      instructions: MODEL_RESULT_SUMMARY_INSTRUCTIONS,
    });
}

function modelPlannerContext(
  context: AiToolExecutionContext
): AssistantModelPlannerContext {
  return {
    requestId: context.requestId,
    activeConnectionId: context.activeConnectionId ?? null,
    activeDriver: context.activeDriver ?? null,
    activeNamespace: context.activeNamespace ?? null,
    activeTab: context.activeTab
      ? {
          ...context.activeTab,
          sql: boundedOptionalModelText(context.activeTab.sql),
          selection: context.activeTab.selection
            ? {
                ...context.activeTab.selection,
                text: boundedRequiredModelText(context.activeTab.selection.text),
              }
            : context.activeTab.selection,
        }
      : null,
  };
}

function modelPlannerTurn(turn: AssistantTurnInput): AssistantTurnInput {
  return {
    ...turn,
    selectedText: boundedNullableModelText(turn.selectedText),
  };
}

const MODEL_CONTEXT_TEXT_LIMIT = 8_000;
const MODEL_CONTEXT_TRUNCATION_SUFFIX = "\n...[truncated]";

function boundedRequiredModelText(text: string) {
  if (text.length <= MODEL_CONTEXT_TEXT_LIMIT) return text;
  return `${text.slice(0, MODEL_CONTEXT_TEXT_LIMIT)}${MODEL_CONTEXT_TRUNCATION_SUFFIX}`;
}

function boundedOptionalModelText(text: string | undefined) {
  if (text === undefined) return undefined;
  return boundedRequiredModelText(text);
}

function boundedNullableModelText(text: string | null | undefined) {
  if (text === null || text === undefined) return text;
  return boundedRequiredModelText(text);
}

const MODEL_PLANNER_INSTRUCTIONS = [
  "Choose tools only from manifest.tools.",
  "Use read-only tools before mutation tools when context is missing.",
  "Never mark a mutating or destructive action as approved; the runtime approval policy controls execution.",
  "Keep inputs bounded and explicit, including connectionId, namespace, collection, table, index, or key when known.",
  "Return an empty steps array when the user intent is unclear.",
];

const MODEL_RESULT_SUMMARY_INSTRUCTIONS = [
  "Summarize only from tool results and the original user turn.",
  "Mention row limits, approval requirements, and tool errors when relevant.",
  "Do not invent database objects, rows, documents, keys, or indexes that are not present in the results.",
  "Return suggestedCalls only when another tool call is clearly needed and available in the manifest.",
];
