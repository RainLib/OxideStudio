import {
  AiToolRegistry,
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
  evaluateAiToolPolicy,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import type { AiToolExecutionPolicy, AiToolSummary } from "@/ai/tools";
import type {
  AssistantIntent,
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCall,
  AssistantToolCallResult,
  AssistantTurnInput,
} from "./types";

export type AssistantRuntimeOptions = {
  registry?: AiToolRegistry;
  createContext?: () => ReturnType<typeof createWorkspaceAiToolContext>;
  policy?: AiToolExecutionPolicy;
};

export class AssistantRuntime {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => ReturnType<typeof createWorkspaceAiToolContext>;
  private readonly policy: AiToolExecutionPolicy;

  constructor(options: AssistantRuntimeOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
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
      suggestedPlan: buildSuggestedPlan(
        intent,
        input,
        availableTools,
        this.policy,
        context.activeDriver
      ),
      warnings,
    };
  }

  async executeTool<TOutput = unknown>(
    toolName: string,
    input: unknown,
    context = this.createContext(),
    policy = this.policy
  ) {
    return this.registry.executeWithPolicy<TOutput>(
      toolName,
      input,
      context,
      policy
    );
  }

  async executeToolCalls(
    calls: AssistantToolCall[],
    context = this.createContext()
  ): Promise<AssistantToolCallResult[]> {
    const results: AssistantToolCallResult[] = [];

    for (const call of calls) {
      const policy = call.approved
        ? approveAiToolForPolicy(this.policy, call.toolName)
        : this.policy;
      const decision = this.registry.evaluate(call.toolName, policy);

      if (!decision.allowed) {
        results.push({
          id: call.id,
          toolName: call.toolName,
          status: decision.requiresApproval ? "requiresApproval" : "error",
          error: decision.reason,
        });
        continue;
      }

      try {
        const output = await this.registry.executeWithPolicy(
          call.toolName,
          call.input ?? {},
          context,
          policy
        );
        results.push({
          id: call.id,
          toolName: call.toolName,
          status: "success",
          output,
        });
      } catch (err: any) {
        results.push({
          id: call.id,
          toolName: call.toolName,
          status: "error",
          error: err?.message || String(err),
        });
      }
    }

    return results;
  }
}

export function createAssistantRuntime(options?: AssistantRuntimeOptions) {
  return new AssistantRuntime(options);
}

function classifyIntent(input: AssistantTurnInput): AssistantIntent {
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

  if (intent === "query" && hasTool("query.runReadOnly")) {
    const query = input.selectedText?.trim() || "";
    const writeTool = selectedMutationTool(query, activeDriver, hasTool);
    steps.push({
      id: "read-query",
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
  if (looksDestructiveSelection(query, activeDriver)) {
    return hasTool("query.runDestructive") ? "query.runDestructive" : null;
  }
  if (looksMutationSelection(query, activeDriver)) {
    return hasTool("query.runMutation") ? "query.runMutation" : null;
  }
  return null;
}

function looksMutationSelection(query: string, activeDriver?: string | null) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const driver = String(activeDriver || "").toLowerCase();
  if (driver === "redis") {
    return /^(append|decr|decrby|expire|hset|hmset|incr|incrby|json\.set|lpush|pfadd|rename|rpush|sadd|set|setex|setnx|xadd|zadd)\b/i.test(
      query.trim()
    );
  }
  if (driver === "mongodb" || driver === "mongo") {
    return /"(insertOne|insertMany|updateOne|updateMany|command)"/i.test(query);
  }
  if (driver === "elasticsearch" || driver === "elastic") {
    return /^(POST|PUT|PATCH)\s+\//i.test(query.trim());
  }

  return /^(alter|call|comment|copy|create|grant|insert|load|merge|replace|revoke|set|update|vacuum)\b/.test(
    normalized
  );
}

function looksDestructiveSelection(query: string, activeDriver?: string | null) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const driver = String(activeDriver || "").toLowerCase();
  if (driver === "redis") {
    return /^(del|discard|eval|evalsha|flushall|flushdb|ft\.dropindex|hdel|json\.del|lpop|rpop|srem|unlink|xdel|zrem)\b/i.test(
      query.trim()
    );
  }
  if (driver === "mongodb" || driver === "mongo") {
    return /"(collMod|deleteOne|deleteMany|drop|dropDatabase|renameCollection)"/i.test(
      query
    );
  }
  if (driver === "elasticsearch" || driver === "elastic") {
    return /^DELETE\s+\//i.test(query.trim()) || query.includes("_delete_by_query");
  }

  return /^(delete|drop|truncate)\b/.test(normalized);
}
