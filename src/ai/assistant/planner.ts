import type {
  AssistantPlanner,
  AssistantPlannerInput,
} from "@/ai/assistant/types";
import { classifyAssistantIntent } from "@/ai/assistant/planner/classifyAssistantIntent";
import { buildSuggestedPlan } from "@/ai/assistant/planner/suggestedPlan";

export { classifyAssistantIntent };

export class DefaultAssistantPlanner implements AssistantPlanner {
  readonly id = "default-rule-planner";
  readonly mode = "deterministic" as const;
  readonly description =
    "Dependency-light planner for editor context, metadata, query, LSP, and approved mutation tools.";

  plan(input: AssistantPlannerInput) {
    const intent = classifyAssistantIntent(input.turn);
    return {
      intent,
      steps: buildSuggestedPlan(
        intent,
        input.turn,
        input.availableTools,
        input.policy,
        input.context.activeDriver,
        input.context.activeNamespace,
        input.context.activeTab?.tableName,
        input.context.activeTab?.sql,
      ),
      notes: [
        "Use this planner as the local fallback; a LangGraph or model planner can implement the same AssistantPlanner contract.",
      ],
    };
  }
}

export function createDefaultAssistantPlanner() {
  return new DefaultAssistantPlanner();
}
