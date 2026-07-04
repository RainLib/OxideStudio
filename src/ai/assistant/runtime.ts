import {
  AiToolRegistry,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import type {
  AssistantIntent,
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantTurnInput,
} from "./types";

export type AssistantRuntimeOptions = {
  registry?: AiToolRegistry;
  createContext?: () => ReturnType<typeof createWorkspaceAiToolContext>;
};

export class AssistantRuntime {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => ReturnType<typeof createWorkspaceAiToolContext>;

  constructor(options: AssistantRuntimeOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
  }

  prepareTurn(input: AssistantTurnInput): AssistantPreparedTurn {
    const context = this.createContext();
    const availableTools = this.registry.list();
    const intent = classifyIntent(input);
    const warnings: string[] = [];

    if (!context.activeConnectionId) {
      warnings.push("No active connection is selected.");
    }
    if (!input.message.trim()) {
      warnings.push("Assistant message is empty.");
    }

    return {
      requestId: context.requestId,
      intent,
      context,
      availableTools,
      suggestedPlan: buildSuggestedPlan(intent, input, availableTools),
      warnings,
    };
  }

  async executeTool<TOutput = unknown>(
    toolName: string,
    input: unknown,
    context = this.createContext()
  ) {
    return this.registry.execute<TOutput>(toolName, input, context);
  }
}

export function createAssistantRuntime(options?: AssistantRuntimeOptions) {
  return new AssistantRuntime(options);
}

function classifyIntent(input: AssistantTurnInput): AssistantIntent {
  const text = `${input.message} ${input.selectedText || ""}`.toLowerCase();
  if (!text.trim()) return "unknown";

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
  tools: Array<{ name: string }>
): AssistantPlanStep[] {
  const hasTool = (name: string) => tools.some((tool) => tool.name === name);
  const steps: AssistantPlanStep[] = [];

  if (hasTool("workspace.getActiveTab")) {
    steps.push({
      id: "workspace-context",
      title: "Read the active editor context",
      toolName: "workspace.getActiveTab",
      input: {},
      requiresApproval: false,
    });
  }

  if (hasTool("connection.list")) {
    steps.push({
      id: "connections",
      title: "Inspect available database connections",
      toolName: "connection.list",
      input: {},
      requiresApproval: false,
    });
  }

  if (intent === "metadata" && hasTool("metadata.listCollections")) {
    steps.push({
      id: "metadata-objects",
      title: "List collections, keys, or indexes for the active namespace",
      toolName: "metadata.listCollections",
      input: {},
      requiresApproval: false,
    });
  }

  if (intent === "query" && hasTool("query.runReadOnly")) {
    const query = input.selectedText?.trim() || "";
    steps.push({
      id: "read-query",
      title: query
        ? "Run the selected query with read-only safeguards"
        : "Prepare a bounded read-only query",
      toolName: query ? "query.runReadOnly" : undefined,
      input: query ? { query } : undefined,
      requiresApproval: false,
    });
  }

  return steps;
}
