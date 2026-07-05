import {
  AiToolRegistry,
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
  createAiToolManifest,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import type { AiToolExecutionPolicy } from "@/ai/tools";
import { createDefaultAssistantPlanner } from "./planner";
import type {
  AssistantPlanner,
  AssistantPlannerInfo,
  AssistantPlannerInput,
  AssistantPlannerResult,
  AssistantPreparedTurn,
  AssistantToolCall,
  AssistantToolCallResult,
  AssistantToolResultSummarizer,
  AssistantToolResultSummary,
  AssistantTurnInput,
} from "./types";

export type AssistantRuntimeOptions = {
  registry?: AiToolRegistry;
  createContext?: () => ReturnType<typeof createWorkspaceAiToolContext>;
  policy?: AiToolExecutionPolicy;
  planner?: AssistantPlanner;
  summarizeToolResults?: AssistantToolResultSummarizer;
};

export class AssistantRuntime {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => ReturnType<typeof createWorkspaceAiToolContext>;
  private readonly policy: AiToolExecutionPolicy;
  private readonly planner: AssistantPlanner;
  private readonly summarizeResults?: AssistantToolResultSummarizer;

  constructor(options: AssistantRuntimeOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
    this.planner = options.planner ?? createDefaultAssistantPlanner();
    this.summarizeResults = options.summarizeToolResults;
  }

  prepareTurn(input: AssistantTurnInput): AssistantPreparedTurn {
    const plannerInput = this.createPlannerInput(input);
    const result = this.planner.plan(plannerInput);
    if (isPromiseLike(result)) {
      throw new Error(
        "Assistant planner is asynchronous; call prepareTurnAsync instead."
      );
    }
    return this.createPreparedTurn(plannerInput, result);
  }

  async prepareTurnAsync(input: AssistantTurnInput): Promise<AssistantPreparedTurn> {
    const plannerInput = this.createPlannerInput(input);
    const result = await this.planner.plan(plannerInput);
    return this.createPreparedTurn(plannerInput, result);
  }

  manifest() {
    return createAiToolManifest(this.registry.list(), this.policy);
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

  async summarizeToolResults(
    turn: AssistantTurnInput,
    results: AssistantToolCallResult[],
    context = this.createContext()
  ): Promise<AssistantToolResultSummary> {
    if (this.summarizeResults) {
      return this.summarizeResults({
        turn,
        context,
        availableTools: this.registry.list(),
        policy: this.policy,
        results,
      });
    }

    return summarizeResultsLocally(results);
  }

  private createPlannerInput(input: AssistantTurnInput): AssistantPlannerInput {
    return {
      turn: input,
      context: this.createContext(),
      availableTools: this.registry.list(),
      policy: this.policy,
    };
  }

  private createPreparedTurn(
    input: AssistantPlannerInput,
    result: AssistantPlannerResult
  ): AssistantPreparedTurn {
    return {
      requestId: input.context.requestId,
      intent: result.intent,
      planner: toPlannerInfo(this.planner),
      context: input.context,
      availableTools: input.availableTools,
      suggestedPlan: result.steps,
      warnings: uniqueStrings([
        ...baseWarnings(input),
        ...(result.warnings ?? []),
      ]),
      notes: uniqueStrings(result.notes ?? []),
    };
  }
}

export function createAssistantRuntime(options?: AssistantRuntimeOptions) {
  return new AssistantRuntime(options);
}

function baseWarnings(input: AssistantPlannerInput) {
  const warnings: string[] = [];
  if (!input.context.activeConnectionId) {
    warnings.push("No active connection is selected.");
  }
  if (!input.turn.message.trim()) {
    warnings.push("Assistant message is empty.");
  }
  return warnings;
}

function toPlannerInfo(planner: AssistantPlanner): AssistantPlannerInfo {
  return {
    id: planner.id,
    mode: planner.mode,
    description: planner.description,
    framework: planner.framework,
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  const candidate = value as { then?: unknown } | null;
  return Boolean(candidate && typeof candidate.then === "function");
}

function summarizeResultsLocally(
  results: AssistantToolCallResult[]
): AssistantToolResultSummary {
  const successCount = results.filter((result) => result.status === "success").length;
  const approvalCount = results.filter(
    (result) => result.status === "requiresApproval"
  ).length;
  const errorCount = results.filter((result) => result.status === "error").length;

  return {
    message: [
      `${successCount} tool call${successCount === 1 ? "" : "s"} succeeded`,
      approvalCount > 0
        ? `${approvalCount} require${approvalCount === 1 ? "s" : ""} approval`
        : null,
      errorCount > 0 ? `${errorCount} failed` : null,
    ]
      .filter(Boolean)
      .join("; "),
    warnings: results
      .filter((result) => result.status !== "success" && result.error)
      .map((result) => `${result.toolName}: ${result.error}`),
  };
}
