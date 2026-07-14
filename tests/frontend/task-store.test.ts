import { beforeEach, describe, expect, it } from "vitest";
import { useTaskStore } from "@/store/useTaskStore";

describe("task store", () => {
  beforeEach(() => {
    useTaskStore.setState(useTaskStore.getInitialState(), true);
  });

  it("tracks task lifecycle", () => {
    const id = useTaskStore.getState().startTask({
      kind: "query",
      title: "Run Query",
      detail: "Executing SQL",
    });

    expect(useTaskStore.getState().tasks).toEqual([
      expect.objectContaining({
        id,
        kind: "query",
        title: "Run Query",
        status: "running",
      }),
    ]);

    useTaskStore.getState().finishTask(id, "1 row");

    expect(useTaskStore.getState().tasks[0]).toEqual(
      expect.objectContaining({
        status: "success",
        detail: "1 row",
        progress: 1,
      })
    );
  });

  it("keeps running tasks when clearing finished tasks", () => {
    const runningId = useTaskStore.getState().startTask({
      kind: "export",
      title: "Export table",
    });
    const finishedId = useTaskStore.getState().startTask({
      kind: "import",
      title: "Import CSV",
    });
    useTaskStore.getState().failTask(finishedId, "bad csv");

    useTaskStore.getState().clearFinished();

    expect(useTaskStore.getState().tasks).toEqual([
      expect.objectContaining({ id: runningId, status: "running" }),
    ]);
  });

  it("replaces project-scoped persistent agent history without removing local tasks", () => {
    const queryId = useTaskStore.getState().startTask({
      kind: "query",
      title: "Run query",
    });
    useTaskStore.getState().upsertTask({
      id: "agent:old",
      kind: "agent",
      title: "Old agent",
      status: "success",
      startedAt: 1,
      projectId: "old-project",
      persistent: true,
    });
    useTaskStore.getState().replacePersistentAgentTasks("project-a", [
      {
        id: "agent:current",
        kind: "agent",
        title: "Current agent",
        status: "waiting",
        startedAt: 2,
        projectId: "project-a",
        persistent: true,
      },
    ]);

    expect(useTaskStore.getState().tasks).toEqual([
      expect.objectContaining({ id: "agent:current", status: "waiting" }),
      expect.objectContaining({ id: queryId, status: "running" }),
    ]);
    useTaskStore.getState().clearFinished();
    expect(useTaskStore.getState().tasks.map((task) => task.id)).toEqual([
      "agent:current",
      queryId,
    ]);
  });

  it("does not let delayed hydration remove a newly started agent task", () => {
    useTaskStore.getState().upsertTask({
      id: "agent:new",
      kind: "agent",
      title: "New agent",
      status: "running",
      startedAt: 2,
      projectId: "project-a",
      persistent: true,
    });

    useTaskStore.getState().replacePersistentAgentTasks("project-a", [
      {
        id: "agent:history",
        kind: "agent",
        title: "Agent history",
        status: "success",
        startedAt: 1,
        projectId: "project-a",
        persistent: true,
      },
    ]);

    expect(useTaskStore.getState().tasks.map((task) => task.id)).toEqual([
      "agent:history",
      "agent:new",
    ]);
  });
});
