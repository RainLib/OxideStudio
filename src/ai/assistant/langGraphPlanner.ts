import type {
  AssistantPlanner,
  AssistantPlannerInput,
  AssistantPlannerResult,
} from "./types";

export type LangGraphAssistantPlannerInvoke = (
  input: AssistantPlannerInput
) => AssistantPlannerResult | Promise<AssistantPlannerResult>;

export type LangGraphAssistantPlannerOptions = {
  id?: string;
  description?: string;
  invoke: LangGraphAssistantPlannerInvoke;
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
