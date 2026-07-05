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
