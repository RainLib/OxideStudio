import { describe, expect, it } from "vitest";
import {
  assistantTaskHasPendingApproval,
  createAssistantTaskRecord,
  finishAssistantTask,
  reduceAssistantTaskEvent,
} from "@/ai/assistant/taskCheckpoint";
import type {
  AssistantPreparedTurn,
  AssistantToolLoopEvent,
} from "@/ai/assistant/types";

const turn: AssistantPreparedTurn = {
  requestId: "request-1",
  intent: "query",
  planner: {
    id: "planner",
    mode: "model",
    description: "Planner",
  },
  context: { requestId: "request-1" },
  availableTools: [],
  suggestedPlan: [
    {
      id: "read",
      title: "Inspect rows",
      toolName: "query.runReadOnly",
      input: { query: "SELECT secret FROM users" },
      requiresApproval: false,
    },
    {
      id: "write",
      title: "Update rows",
      toolName: "query.runMutation",
      input: { query: "UPDATE users SET secret = 'private'" },
      requiresApproval: true,
    },
  ],
  warnings: [],
  notes: [],
};

describe("assistant task checkpoint", () => {
  it("persists plan identity and risk without tool inputs or result output", () => {
    let task = createAssistantTaskRecord({
      projectId: "project-a",
      sessionId: "session-a",
      turn,
      now: 10,
    });
    const completed: AssistantToolLoopEvent = {
      type: "stepCompleted",
      step: turn.suggestedPlan[0]!,
      result: {
        id: "read",
        toolName: "query.runReadOnly",
        status: "success",
        output: { rows: [["private-result"]] },
      },
      round: 1,
      totalCalls: 1,
    };
    task = reduceAssistantTaskEvent(task, completed, 20);

    const serialized = JSON.stringify(task);
    expect(serialized).not.toContain("SELECT secret");
    expect(serialized).not.toContain("UPDATE users");
    expect(serialized).not.toContain("private-result");
    expect(task.checkpoint).toEqual({
      version: 1,
      mode: "agent",
      plan: [
        expect.objectContaining({
          id: "read",
          toolName: "query.runReadOnly",
          requiresApproval: false,
        }),
        expect.objectContaining({
          id: "write",
          toolName: "query.runMutation",
          requiresApproval: true,
        }),
      ],
      completedSteps: [
        {
          id: "read",
          toolName: "query.runReadOnly",
          status: "success",
        },
      ],
    });
    expect(assistantTaskHasPendingApproval(task)).toBe(true);
    expect(finishAssistantTask(task, "awaitingApproval", 30)).toMatchObject({
      status: "awaiting_approval",
      detail: "Waiting for approval",
      finishedAt: null,
    });
  });

  it("adds normalized follow-up metadata without persisting follow-up inputs", () => {
    const initial = createAssistantTaskRecord({
      projectId: "project-a",
      sessionId: "session-a",
      turn,
      now: 10,
    });
    const next = reduceAssistantTaskEvent(
      initial,
      {
        type: "planExtended",
        steps: [
          {
            id: "follow-up",
            title: "Inspect indexes",
            toolName: "metadata.describeObject",
            input: { password: "do-not-store" },
            requiresApproval: false,
          },
        ],
        warnings: [],
      },
      20,
    );
    expect(next.checkpoint.plan.at(-1)).toEqual({
      id: "follow-up",
      title: "Inspect indexes",
      toolName: "metadata.describeObject",
      requiresApproval: false,
    });
    expect(JSON.stringify(next)).not.toContain("do-not-store");
  });
});
