import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeRawCommand: vi.fn(),
}));

vi.mock("@/services/tauri/client", () => ({
  invokeRawCommand: mocks.invokeRawCommand,
}));

import {
  ASSISTANT_TASK_SESSION_ID,
  assistantTaskService,
  type AssistantTaskRecord,
} from "@/services/tauri/assistant-task.service";

const task: AssistantTaskRecord = {
  id: "agent:request-1",
  projectId: "project-a",
  requestId: "request-1",
  sessionId: ASSISTANT_TASK_SESSION_ID,
  status: "running",
  title: "Assistant agent task",
  detail: "Inspect metadata",
  currentStepId: "inspect",
  currentToolName: "metadata.listObjects",
  progress: 0.5,
  checkpoint: {
    version: 1,
    mode: "agent",
    plan: [],
    completedSteps: [],
  },
  createdAt: 10,
  updatedAt: 20,
  finishedAt: null,
};

describe("assistant task service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves and recovers tasks with an application-session identity", async () => {
    mocks.invokeRawCommand.mockResolvedValueOnce(undefined).mockResolvedValueOnce([task]);

    await assistantTaskService.save(task);
    await expect(assistantTaskService.list("project-a", 25)).resolves.toEqual([
      task,
    ]);

    expect(mocks.invokeRawCommand).toHaveBeenNthCalledWith(
      1,
      "save_assistant_task",
      { task },
    );
    expect(mocks.invokeRawCommand).toHaveBeenNthCalledWith(
      2,
      "get_assistant_tasks",
      {
        projectId: "project-a",
        sessionId: ASSISTANT_TASK_SESSION_ID,
        limit: 25,
      },
    );
  });

  it("clears only terminal tasks in the requested project", async () => {
    mocks.invokeRawCommand.mockResolvedValue(undefined);
    await assistantTaskService.clearFinished("project-b");
    expect(mocks.invokeRawCommand).toHaveBeenCalledWith(
      "clear_finished_assistant_tasks",
      { projectId: "project-b" },
    );
  });
});
