/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceUiActionRegistry } from "@/ai/ui-actions/workspaceRegistry";
import {
  captureWorkspaceUiActionContext,
  resetUiActionContextTracker,
} from "@/ai/ui-actions/context";
import { useProjectStore } from "@/store/useProjectStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useTaskNavigationStore } from "@/lib/taskNavigation";

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => []),
}));

vi.mock("@/services/tauri/assistant-task.service", () => ({
  assistantTaskService: {
    list: mocks.list,
  },
}));

describe("workspace task UI action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetUiActionContextTracker();
    useProjectStore.setState({
      activeProjectId: "project-a",
      activeProjectName: "Project A",
    });
    useTaskStore.setState({ tasks: [] });
    useTaskNavigationStore.setState({ request: null });
  });

  it("reveals an in-memory task by stable project and task identity", async () => {
    useTaskStore.getState().upsertTask({
      id: "agent:request-1",
      kind: "agent",
      title: "Assistant agent task",
      status: "success",
      startedAt: 1,
      projectId: "project-a",
      persistent: true,
      steps: [],
    });

    const result = await executeTaskReveal("agent:request-1");

    expect(result).toMatchObject({ status: "success", code: "OK" });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(useTaskNavigationStore.getState().request?.target).toEqual({
      projectId: "project-a",
      taskId: "agent:request-1",
    });
  });

  it("hydrates a retained task before revealing it", async () => {
    mocks.list.mockResolvedValueOnce([
      {
        id: "agent:retained",
        projectId: "project-a",
        requestId: "request-2",
        sessionId: "session-old",
        status: "interrupted",
        title: "Assistant agent task",
        detail: "Application closed before the task completed",
        checkpoint: {
          version: 1,
          mode: "agent",
          plan: [],
          completedSteps: [],
        },
        createdAt: 1,
        updatedAt: 2,
        finishedAt: 2,
      },
    ]);

    const result = await executeTaskReveal("agent:retained");

    expect(result).toMatchObject({ status: "success", code: "OK" });
    expect(mocks.list).toHaveBeenCalledWith("project-a", 100);
    expect(useTaskStore.getState().tasks[0]?.id).toBe("agent:retained");
  });

  it("returns a stable not-found result after checking retained history", async () => {
    await expect(executeTaskReveal("agent:missing")).resolves.toMatchObject({
      status: "notFound",
      code: "TARGET_NOT_FOUND",
      recovery: "Refresh the workspace context and try again.",
    });
  });
});

async function executeTaskReveal(taskId: string) {
  const context = captureWorkspaceUiActionContext();
  return await createWorkspaceUiActionRegistry().execute({
    id: `reveal-${taskId}`,
    action: "task.reveal",
    target: { projectId: "project-a", taskId },
    issuedAgainst: {
      projectId: context.projectId,
      contextVersion: context.contextVersion,
    },
    presentation: { label: "Reveal task" },
  });
}
