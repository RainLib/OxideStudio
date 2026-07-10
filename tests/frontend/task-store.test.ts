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
});
