import { describe, expect, it } from "vitest";
import { assistantTaskToWorkbenchTask } from "@/lib/assistantTaskProjection";

describe("assistant task projection", () => {
  it("marks a terminal started mutation as uncertain verification work", () => {
    const task = assistantTaskToWorkbenchTask({
      id: "agent:uncertain",
      projectId: "project-a",
      requestId: "request-a",
      sessionId: "old-session",
      status: "cancelled",
      title: "Assistant agent task",
      detail: "Application closed before the task completed",
      checkpoint: {
        version: 2,
        mode: "agent",
        plan: [
          {
            id: "write",
            title: "Update rows",
            toolName: "query.runMutation",
            requiresApproval: true,
          },
        ],
        completedSteps: [],
        executionReceipts: [
          {
            stepId: "write",
            toolName: "query.runMutation",
            status: "started",
            startedAt: 10,
            finishedAt: null,
          },
        ],
      },
      createdAt: 1,
      updatedAt: 20,
      finishedAt: 20,
    });

    expect(task.steps).toEqual([
      expect.objectContaining({ id: "write", status: "uncertain" }),
    ]);
  });
});
