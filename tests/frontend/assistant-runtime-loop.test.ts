import { describe, expect, it, vi } from "vitest";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import type {
  AssistantPlanStep,
  AssistantToolLoopEvent,
  AssistantToolResultSummarizer,
} from "@/ai/assistant/types";
import { createAiToolRegistry } from "@/ai/tools/registry";

const context = {
  requestId: "loop-request",
  activeConnectionId: "connection-1",
};

function createLoopRuntime(
  initialStep: AssistantPlanStep,
  summarizeToolResults?: AssistantToolResultSummarizer,
) {
  const read = vi.fn(async (input: unknown) => input);
  const write = vi.fn(async (input: unknown) => input);
  const registry = createAiToolRegistry();
  registry.register({
    name: "demo.read",
    description: "Read a value.",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    execute: read,
  });
  registry.register({
    name: "demo.write",
    description: "Write a value.",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    permissions: ["write"],
    capabilities: ["workspace"],
    execute: write,
  });
  const runtime = createAssistantRuntime({
    registry,
    createContext: () => context,
    summarizeToolResults,
    planner: {
      id: "loop-planner",
      mode: "deterministic",
      description: "Loop test planner.",
      plan: () => ({ intent: "workspace", steps: [initialStep] }),
    },
  });
  return { runtime, read, write };
}

describe("AssistantRuntime tool loop", () => {
  it("owns safe follow-up execution, signature deduplication, and plan events", async () => {
    let summaryRound = 0;
    const summarize = vi.fn(async () => {
      summaryRound += 1;
      return summaryRound === 1
        ? {
            message: "First round complete",
            suggestedCalls: [
              {
                id: "follow-read",
                toolName: "demo.read",
                input: { value: "next" },
              },
              {
                id: "follow-write",
                toolName: "demo.write",
                input: { value: "change" },
              },
            ],
          }
        : {
            message: "Second round complete",
            suggestedCalls: [
              {
                id: "duplicate-read",
                toolName: "demo.read",
                input: { value: "next" },
              },
            ],
          };
    });
    const initialStep: AssistantPlanStep = {
      id: "initial-read",
      title: "Initial read",
      toolName: "demo.read",
      input: { value: "initial" },
      requiresApproval: false,
    };
    const { runtime, read, write } = createLoopRuntime(initialStep, summarize);
    const turn = await runtime.prepareTurnAsync({ message: "Inspect values" });
    const events: AssistantToolLoopEvent[] = [];

    const result = await runtime.runToolLoop({
      turn,
      summaryInput: { message: "Inspect values" },
      steps: turn.suggestedPlan,
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      status: "completed",
      rounds: 2,
      toolCalls: 2,
    });
    expect(result.results.map((item) => item.id)).toEqual([
      "initial-read",
      "follow-read",
    ]);
    expect(result.followUpSteps).toEqual([
      expect.objectContaining({
        id: "follow-read",
        requiresApproval: false,
      }),
      expect.objectContaining({
        id: "follow-write",
        requiresApproval: true,
      }),
    ]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === "roundSummarized")).toHaveLength(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "planExtended",
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "follow-write" }),
        ]),
      }),
    );
  });

  it("does not execute a write unless the exact step id is approved", async () => {
    const step: AssistantPlanStep = {
      id: "write-step",
      title: "Write",
      toolName: "demo.write",
      input: { value: "change" },
      requiresApproval: false,
    };
    const { runtime, write } = createLoopRuntime(step);
    const turn = await runtime.prepareTurnAsync({ message: "Change value" });
    expect(turn.suggestedPlan[0]?.requiresApproval).toBe(true);

    const blocked = await runtime.runToolLoop({
      turn,
      summaryInput: { message: "Change value" },
      steps: turn.suggestedPlan,
    });
    expect(blocked).toMatchObject({
      status: "failed",
      toolCalls: 1,
      results: [expect.objectContaining({ status: "requiresApproval" })],
    });
    expect(write).not.toHaveBeenCalled();

    const approved = await runtime.runToolLoop({
      turn,
      summaryInput: { message: "Change value" },
      steps: turn.suggestedPlan,
      approvedStepIds: new Set(["write-step"]),
    });
    expect(approved.status).toBe("completed");
    expect(write).toHaveBeenCalledOnce();
  });

  it("returns a bounded limit state when safe follow-ups do not converge", async () => {
    let next = 0;
    const step: AssistantPlanStep = {
      id: "read-0",
      title: "Read",
      toolName: "demo.read",
      input: { value: "0" },
      requiresApproval: false,
    };
    const { runtime, read } = createLoopRuntime(step, async () => {
      next += 1;
      return {
        message: `Round ${next}`,
        suggestedCalls: [
          {
            id: `read-${next}`,
            toolName: "demo.read",
            input: { value: String(next) },
          },
        ],
      };
    });
    const turn = await runtime.prepareTurnAsync({ message: "Keep reading" });
    const events: AssistantToolLoopEvent[] = [];

    const result = await runtime.runToolLoop({
      turn,
      summaryInput: { message: "Keep reading" },
      steps: turn.suggestedPlan,
      limits: { maxFollowUpRounds: 2, maxToolCalls: 10 },
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({
      status: "limitReached",
      rounds: 2,
      toolCalls: 2,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.warnings[0]).toContain("2 rounds or 10 tool calls");
    expect(events.at(-1)).toMatchObject({ type: "limitReached" });
  });

  it("stops after cancellation and reports cancelled instead of tool failure", async () => {
    const step: AssistantPlanStep = {
      id: "read-cancel",
      title: "Read",
      toolName: "demo.read",
      input: { value: "cancel" },
      requiresApproval: false,
    };
    const { runtime } = createLoopRuntime(step);
    const turn = await runtime.prepareTurnAsync({ message: "Cancel read" });
    const controller = new AbortController();

    const result = await runtime.runToolLoop({
      turn,
      summaryInput: { message: "Cancel read" },
      steps: turn.suggestedPlan,
      context: { ...turn.context, abortSignal: controller.signal },
      onEvent: (event) => {
        if (event.type === "stepStarted") controller.abort();
      },
    });

    expect(result).toMatchObject({
      status: "cancelled",
      rounds: 0,
      toolCalls: 0,
    });
  });
});
