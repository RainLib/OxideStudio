import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { evaluateAiToolPolicy } from "@/ai/tools/policy";
import { createDefaultAssistantPlanner } from "./planner";
import type {
  AssistantPlanner,
  AssistantPlannerInput,
  AssistantPlannerResult,
  AssistantPlanStep,
} from "./types";

export type LangGraphAssistantPlannerInvoke = (
  input: AssistantPlannerInput
) => AssistantPlannerResult | Promise<AssistantPlannerResult>;

export type LangGraphAssistantPlannerOptions = {
  id?: string;
  description?: string;
  invoke: LangGraphAssistantPlannerInvoke;
};

export type OfficialLangGraphAssistantPlannerOptions = {
  id?: string;
  description?: string;
  primaryPlanner?: AssistantPlanner;
  fallbackPlanner?: AssistantPlanner;
};

export type AssistantPlannerGraphState = AssistantPlannerInput & {
  result?: AssistantPlannerResult;
  warnings: string[];
  notes: string[];
  metadata: Record<string, unknown>;
};

export type AssistantPlannerGraphPatch = Partial<
  Pick<AssistantPlannerGraphState, "result" | "metadata">
> & {
  warnings?: string[];
  notes?: string[];
};

export type AssistantPlannerGraphNode = (
  state: AssistantPlannerGraphState
) => AssistantPlannerGraphPatch | Promise<AssistantPlannerGraphPatch>;

export type AssistantPlannerGraphOptions = {
  nodes: AssistantPlannerGraphNode[];
};

export class LangGraphAssistantPlanner implements AssistantPlanner {
  readonly id: string;
  readonly mode = "graph" as const;
  readonly framework = "langgraph";
  readonly description: string;

  private readonly invoke: LangGraphAssistantPlannerInvoke;

  constructor(options: LangGraphAssistantPlannerOptions) {
    this.id = options.id || "langgraph-tool-planner";
    this.description =
      options.description ||
      "LangGraph-backed planner that returns Oxide assistant tool steps from the shared AI tool registry.";
    this.invoke = options.invoke;
  }

  plan(input: AssistantPlannerInput) {
    return this.invoke(input);
  }
}

export function createLangGraphAssistantPlanner(
  options: LangGraphAssistantPlannerOptions
) {
  return new LangGraphAssistantPlanner(options);
}

export function createOfficialLangGraphAssistantPlanner(
  options: OfficialLangGraphAssistantPlannerOptions = {}
) {
  const fallbackPlanner = options.fallbackPlanner ?? createDefaultAssistantPlanner();
  const primaryPlanner = options.primaryPlanner ?? fallbackPlanner;
  const graph = createOfficialAssistantPlannerGraph(primaryPlanner, fallbackPlanner);

  return createLangGraphAssistantPlanner({
    id: options.id || "official-langgraph-tool-planner",
    description:
      options.description ||
      "Official @langchain/langgraph planner plugin for Oxide assistant tool planning, policy annotation, and deterministic fallback.",
    invoke: async (input) => {
      const state = await graph.invoke({
        input,
        result: undefined,
        warnings: [],
        notes: [],
      });

      return {
        intent: state.result?.intent ?? "unknown",
        steps: state.result?.steps ?? [],
        warnings: state.warnings,
        notes: state.notes,
      };
    },
  });
}

const OfficialPlannerGraphState = Annotation.Root({
  input: Annotation<AssistantPlannerInput>(),
  result: Annotation<AssistantPlannerResult | undefined>(),
  warnings: Annotation<string[]>({
    reducer: (left, right) => uniqueStrings([...left, ...right]),
    default: () => [],
  }),
  notes: Annotation<string[]>({
    reducer: (left, right) => uniqueStrings([...left, ...right]),
    default: () => [],
  }),
});

function createOfficialAssistantPlannerGraph(
  primaryPlanner: AssistantPlanner,
  fallbackPlanner: AssistantPlanner
) {
  return new StateGraph(OfficialPlannerGraphState)
    .addNode("plan", async (state: typeof OfficialPlannerGraphState.State) => {
      try {
        const result = await primaryPlanner.plan(state.input);
        return {
          result,
          notes: [
            `Planner node completed with ${primaryPlanner.id}.`,
            ...(result.notes ?? []),
          ],
          warnings: result.warnings ?? [],
        };
      } catch (error: any) {
        const fallback = await fallbackPlanner.plan(state.input);
        return {
          result: fallback,
          notes: [
            `Planner node fell back to ${fallbackPlanner.id}.`,
            ...(fallback.notes ?? []),
          ],
          warnings: [
            `LangGraph primary planner failed: ${error?.message || String(error)}`,
            ...(fallback.warnings ?? []),
          ],
        };
      }
    })
    .addNode("policy", (state: typeof OfficialPlannerGraphState.State) => {
      const result = state.result;
      if (!result) {
        return {
          result: {
            intent: "unknown" as const,
            steps: [],
          },
          warnings: ["LangGraph planner produced no result."],
        };
      }

      const warnings: string[] = [];
      const steps = enforceAssistantToolPolicy(state.input, result.steps, warnings);
      return {
        result: {
          ...result,
          steps,
        },
        warnings,
      };
    })
    .addEdge(START, "plan")
    .addEdge("plan", "policy")
    .addEdge("policy", END)
    .compile();
}

function enforceAssistantToolPolicy(
  input: AssistantPlannerInput,
  steps: AssistantPlanStep[],
  warnings: string[]
): AssistantPlanStep[] {
  const toolsByName = new Map(input.availableTools.map((tool) => [tool.name, tool]));

  return steps.flatMap((step): AssistantPlanStep[] => {
    if (!step.toolName) return [step];

    const tool = toolsByName.get(step.toolName);
    if (!tool) {
      warnings.push(`LangGraph planner requested unknown tool: ${step.toolName}`);
      return [];
    }

    const decision = evaluateAiToolPolicy(tool, input.policy);
    return [
      {
        ...step,
        input: step.input || {},
        requiresApproval: decision.requiresApproval,
      },
    ];
  });
}

export function createAssistantPlannerGraph(
  options: AssistantPlannerGraphOptions
): LangGraphAssistantPlannerInvoke {
  const nodes = [...options.nodes];

  return async (input) => {
    let state: AssistantPlannerGraphState = {
      ...input,
      warnings: [],
      notes: [],
      metadata: {},
    };

    for (const node of nodes) {
      const patch = await node(state);
      state = mergeGraphState(state, patch);
    }

    const result = state.result ?? {
      intent: "unknown" as const,
      steps: [],
    };

    return {
      ...result,
      warnings: uniqueStrings([
        ...(result.warnings ?? []),
        ...state.warnings,
      ]),
      notes: uniqueStrings([...(result.notes ?? []), ...state.notes]),
    };
  };
}

function mergeGraphState(
  state: AssistantPlannerGraphState,
  patch: AssistantPlannerGraphPatch | undefined
): AssistantPlannerGraphState {
  if (!patch) return state;

  return {
    ...state,
    result: patch.result ?? state.result,
    metadata: {
      ...state.metadata,
      ...(patch.metadata ?? {}),
    },
    warnings: uniqueStrings([...state.warnings, ...(patch.warnings ?? [])]),
    notes: uniqueStrings([...state.notes, ...(patch.notes ?? [])]),
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
