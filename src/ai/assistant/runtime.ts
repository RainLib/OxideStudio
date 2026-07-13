import type { AiToolRegistry } from "@/ai/tools/registry";
import {
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
  evaluateAiToolPolicy,
} from "@/ai/tools/policy";
import { createAiToolManifest } from "@/ai/tools/manifest";
import type {
  AiToolExecutionContext,
  AiToolExecutionPolicy,
  AiToolSummary,
} from "@/ai/tools/types";
import { createDefaultAssistantPlanner } from "./planner";
import type {
  AssistantPlanner,
  AssistantPlannerInfo,
  AssistantPlannerInput,
  AssistantPlannerResult,
  AssistantPlanStep,
  AssistantPreparedTurn,
  AssistantToolCall,
  AssistantToolCallResult,
  AssistantToolResultSummarizer,
  AssistantToolResultSummary,
  AssistantTurnInput,
} from "./types";

export type AssistantRuntimeOptions = {
  registry: AiToolRegistry;
  createContext: () => AiToolExecutionContext;
  policy?: AiToolExecutionPolicy;
  planner?: AssistantPlanner;
  summarizeToolResults?: AssistantToolResultSummarizer;
};

export class AssistantRuntime {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;
  private readonly policy: AiToolExecutionPolicy;
  private readonly planner: AssistantPlanner;
  private readonly summarizeResults?: AssistantToolResultSummarizer;

  constructor(options: AssistantRuntimeOptions) {
    this.registry = options.registry;
    this.createContext = options.createContext;
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

  async prepareTurnAsync(
    input: AssistantTurnInput,
    contextOverrides?: Partial<AiToolExecutionContext>
  ): Promise<AssistantPreparedTurn> {
    const plannerInput = this.createPlannerInput(input, contextOverrides);
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
          status:
            !decision.allowed && decision.requiresApproval
              ? "requiresApproval"
              : "error",
          error: decision.reason || err?.message || String(err),
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
      try {
        return await this.summarizeResults({
          turn,
          context,
          availableTools: this.registry.list(),
          policy: this.policy,
          results,
        });
      } catch {
        const fallback = summarizeResultsLocally(results);
        return {
          ...fallback,
          message: `${fallback.message}. Detailed model summary unavailable.`,
          warnings: uniqueStrings([
            ...(fallback.warnings ?? []),
            "Model result summary failed; used the local summary.",
          ]),
        };
      }
    }

    return summarizeResultsLocally(results);
  }

  normalizeSuggestedCalls(
    calls: AssistantToolCall[],
    existingIds: Iterable<string> = []
  ) {
    const warnings: string[] = [];
    const steps = calls.slice(0, 12).map((call) => {
      const input = isRecord(call.input) ? call.input : {};
      if (call.input !== undefined && !isRecord(call.input)) {
        warnings.push(
          `Assistant follow-up ${call.toolName} had a non-object input and was normalized.`
        );
      }
      return {
        id: call.id,
        title: call.reason?.trim() || `Run ${call.toolName}`,
        toolName: call.toolName,
        input,
        requiresApproval: false,
      };
    });
    if (calls.length > steps.length) {
      warnings.push("Assistant follow-up calls were capped at 12.");
    }
    const normalized = normalizeSuggestedPlan(
      steps,
      this.registry.list(),
      this.policy,
      existingIds
    );
    return {
      steps: normalized.steps,
      warnings: uniqueStrings([...warnings, ...normalized.warnings]),
    };
  }

  private createPlannerInput(
    input: AssistantTurnInput,
    contextOverrides?: Partial<AiToolExecutionContext>
  ): AssistantPlannerInput {
    return {
      turn: input,
      context: { ...this.createContext(), ...contextOverrides },
      availableTools: this.registry.list(),
      policy: this.policy,
    };
  }

  private createPreparedTurn(
    input: AssistantPlannerInput,
    result: AssistantPlannerResult
  ): AssistantPreparedTurn {
    const normalizedPlan = normalizeSuggestedPlan(
      result.steps,
      input.availableTools,
      input.policy
    );
    return {
      requestId: input.context.requestId,
      intent: result.intent,
      planner: toPlannerInfo(this.planner),
      context: input.context,
      availableTools: input.availableTools,
      suggestedPlan: normalizedPlan.steps,
      warnings: uniqueStrings([
        ...baseWarnings(input),
        ...(result.warnings ?? []),
        ...normalizedPlan.warnings,
      ]),
      notes: uniqueStrings(result.notes ?? []),
    };
  }
}

export function createAssistantRuntime(options: AssistantRuntimeOptions) {
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

function normalizeSuggestedPlan(
  steps: AssistantPlanStep[],
  tools: AiToolSummary[],
  policy: AiToolExecutionPolicy,
  existingIds: Iterable<string> = []
) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const usedIds = new Set(existingIds);
  const warnings: string[] = [];
  const normalizedSteps: AssistantPlanStep[] = [];

  for (const [index, step] of steps.entries()) {
    const tool = step.toolName ? toolsByName.get(step.toolName) : null;
    if (step.toolName && !tool) {
      warnings.push(`Assistant planner requested unknown tool: ${step.toolName}`);
      continue;
    }

    let requiresApproval = false;
    if (tool) {
      const decision = evaluateAiToolPolicy(tool, policy);
      if (!decision.allowed && !decision.requiresApproval) {
        warnings.push(
          `Assistant planner requested blocked tool ${tool.name}: ${
            decision.reason || "tool is denied by policy"
          }`
        );
        continue;
      }
      requiresApproval = decision.requiresApproval;
    }

    const fallbackId = step.toolName || `plan-step-${index + 1}`;
    const baseId = step.id?.trim().slice(0, 120) || fallbackId;
    let id = baseId;
    let duplicateIndex = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    usedIds.add(id);

    normalizedSteps.push({
      ...step,
      id,
      requiresApproval,
    });
  }

  return { steps: normalizedSteps, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
