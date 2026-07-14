import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryStore } from "@/store/useHistoryStore";

const mocks = vi.hoisted(() => ({
  getHistory: vi.fn(async () => []),
  saveEntries: vi.fn(async () => undefined),
  deleteEntry: vi.fn(async () => undefined),
  clearHistory: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri/query-history.service", () => ({
  queryHistoryService: mocks,
}));

function createStorageMock(initial: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
    clear: vi.fn(() => storage.clear()),
  };
}

describe("query history store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageMock());
    useHistoryStore.setState(useHistoryStore.getInitialState(), true);
  });

  it("loads project-scoped SQLite history", async () => {
    mocks.getHistory.mockResolvedValueOnce([
      {
        id: "history-1",
        projectId: "project-1",
        connectionId: "connection-1",
        connectionName: "Local",
        driver: "postgres",
        databaseName: "app",
        schemaName: "public",
        sql: "SELECT 1",
        status: "success",
        durationMs: 8,
        rowCount: 1,
        errorMessage: null,
        executionMode: "console",
        startedAt: 10,
        finishedAt: 18,
      },
    ]);

    await useHistoryStore.getState().loadHistory("project-1");

    expect(mocks.getHistory).toHaveBeenCalledWith("project-1", 500);
    expect(useHistoryStore.getState()).toMatchObject({
      projectId: "project-1",
      isLoading: false,
      error: null,
      history: [expect.objectContaining({ id: "history-1" })],
    });
  });

  it("migrates legacy localStorage entries once into SQLite", async () => {
    const storage = createStorageMock({
      "query-history": JSON.stringify({
        state: {
          history: [{ id: "old", sql: "SELECT 42", timestamp: 123 }],
        },
      }),
    });
    vi.stubGlobal("localStorage", storage);

    await useHistoryStore.getState().loadHistory("project-1");

    expect(mocks.saveEntries).toHaveBeenCalledWith([
      expect.objectContaining({
        projectId: "project-1",
        sql: "SELECT 42",
        status: "success",
        startedAt: 123,
      }),
    ]);
    expect(storage.removeItem).toHaveBeenCalledWith("query-history");
    expect(useHistoryStore.getState().history[0]?.sql).toBe("SELECT 42");
  });

  it("optimistically records and persists every execution", async () => {
    useHistoryStore.setState({ projectId: "project-1" });

    const item = useHistoryStore.getState().recordExecution({
      projectId: "project-1",
      connectionId: "connection-1",
      connectionName: "Local",
      driver: "postgres",
      databaseName: "app",
      schemaName: "public",
      sql: "SELECT 1",
      status: "success",
      durationMs: 5,
      rowCount: 1,
      errorMessage: null,
      executionMode: "console",
      startedAt: 10,
      finishedAt: 15,
    });

    expect(item.id).toBeTruthy();
    expect(useHistoryStore.getState().history).toEqual([item]);
    await Promise.resolve();
    expect(mocks.saveEntries).toHaveBeenCalledWith([item]);
  });

  it("restores an optimistically removed entry when persistence fails", async () => {
    const entry = {
      id: "history-1",
      projectId: "project-1",
      connectionId: null,
      connectionName: null,
      driver: null,
      databaseName: null,
      schemaName: null,
      sql: "SELECT 1",
      status: "success" as const,
      durationMs: 1,
      rowCount: 1,
      errorMessage: null,
      executionMode: "console" as const,
      startedAt: 1,
      finishedAt: 2,
    };
    useHistoryStore.setState({ projectId: "project-1", history: [entry] });
    mocks.deleteEntry.mockRejectedValueOnce(new Error("disk unavailable"));

    await expect(
      useHistoryStore.getState().removeHistory(entry.id)
    ).rejects.toThrow("disk unavailable");

    expect(useHistoryStore.getState().history).toEqual([entry]);
    expect(useHistoryStore.getState().error).toContain("disk unavailable");
  });
});
