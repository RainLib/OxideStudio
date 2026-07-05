import { evaluateAiToolPolicy } from "@/ai/tools";
import { classifyAiQuerySafety } from "@/lib/querySafety";
import type { AiToolExecutionPolicy, AiToolSummary } from "@/ai/tools";
import type {
  AssistantIntent,
  AssistantPlanner,
  AssistantPlannerInput,
  AssistantPlanStep,
  AssistantTurnInput,
} from "./types";

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
        input.context.activeDriver
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

export function classifyAssistantIntent(
  input: AssistantTurnInput
): AssistantIntent {
  const text = `${input.message} ${input.selectedText || ""}`.toLowerCase();
  if (!text.trim()) return "unknown";

  if (
    /\b(create|delete|drop|insert|remove|replace|set|truncate|update|upsert|write)\b/.test(
      text
    )
  ) {
    return "query";
  }
  if (/\b(schema|table|collection|index|key|metadata|database|list)\b/.test(text)) {
    return "metadata";
  }
  if (/\b(query|select|find|search|run|execute|count|aggregate)\b/.test(text)) {
    return "query";
  }
  if (/\b(explain|diagnostic|error|fix|why|optimi[sz]e)\b/.test(text)) {
    return "explain";
  }
  if (/\b(tab|selection|editor|workspace|current)\b/.test(text)) {
    return "workspace";
  }

  return "unknown";
}

function buildSuggestedPlan(
  intent: AssistantIntent,
  input: AssistantTurnInput,
  tools: AiToolSummary[],
  policy: AiToolExecutionPolicy,
  activeDriver?: string | null
): AssistantPlanStep[] {
  const hasTool = (name: string) => tools.some((tool) => tool.name === name);
  const requiresApproval = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return false;
    return evaluateAiToolPolicy(tool, policy).requiresApproval;
  };
  const steps: AssistantPlanStep[] = [];

  if (hasTool("workspace.getActiveTab")) {
    steps.push({
      id: "workspace-context",
      title: "Read the active editor context",
      toolName: "workspace.getActiveTab",
      input: {},
      requiresApproval: requiresApproval("workspace.getActiveTab"),
    });
  }

  if (hasTool("workspace.getSelection")) {
    steps.push({
      id: "workspace-selection",
      title: "Read the current editor selection",
      toolName: "workspace.getSelection",
      input: {},
      requiresApproval: requiresApproval("workspace.getSelection"),
    });
  }

  if (hasTool("connection.list")) {
    steps.push({
      id: "connections",
      title: "Inspect available database connections",
      toolName: "connection.list",
      input: {},
      requiresApproval: requiresApproval("connection.list"),
    });
  }

  if (intent === "metadata" && hasTool("metadata.listObjects")) {
    steps.push({
      id: "metadata-objects",
      title: "List objects for the active namespace",
      toolName: "metadata.listObjects",
      input: {},
      requiresApproval: requiresApproval("metadata.listObjects"),
    });
  } else if (intent === "metadata" && hasTool("metadata.listCollections")) {
    steps.push({
      id: "metadata-collections",
      title: "List collections, keys, or indexes for the active namespace",
      toolName: "metadata.listCollections",
      input: {},
      requiresApproval: requiresApproval("metadata.listCollections"),
    });
  }

  if (intent === "explain" && hasTool("lsp.explainDiagnostics")) {
    steps.push({
      id: "lsp-diagnostics",
      title: "Explain current LSP diagnostics",
      toolName: "lsp.explainDiagnostics",
      input: { onlySelection: Boolean(input.selectedText?.trim()) },
      requiresApproval: requiresApproval("lsp.explainDiagnostics"),
    });
  }

  if (intent === "query" && hasTool("query.runReadOnly")) {
    const query = input.selectedText?.trim() || "";
    const writeTool = selectedMutationTool(query, activeDriver, hasTool);
    steps.push({
      id: "query-execution",
      title: writeTool
        ? "Run the selected mutation with approval"
        : query
          ? "Run the selected query with read-only safeguards"
          : "Prepare a bounded read-only query",
      toolName: query ? writeTool || "query.runReadOnly" : undefined,
      input: query ? { query } : undefined,
      requiresApproval: query
        ? requiresApproval(writeTool || "query.runReadOnly")
        : false,
    });
  }

  return steps;
}

function selectedMutationTool(
  query: string,
  activeDriver: string | null | undefined,
  hasTool: (name: string) => boolean
) {
  if (!query) return null;
  const safety = classifyAiQuerySafety(query, activeDriver);
  if (safety === "destructive") {
    return hasTool("query.runDestructive") ? "query.runDestructive" : null;
  }
  if (safety === "write") {
    return hasTool("query.runMutation") ? "query.runMutation" : null;
  }
  return null;
}
