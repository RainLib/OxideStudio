import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn(async () => undefined),
  getProjects: vi.fn(async () => []),
  loadConnections: vi.fn(async () => []),
  disconnect: vi.fn(async () => "ok"),
  getResources: vi.fn(async () => []),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    loadConnections: mocks.loadConnections,
    disconnect: mocks.disconnect,
  },
  schemaService: {},
  storeService: {
    getResources: mocks.getResources,
  },
}));

vi.mock("@/services/tauri/store.service", () => ({
  storeService: {
    saveProject: mocks.saveProject,
    getProjects: mocks.getProjects,
  },
}));

function createStorageMock() {
  const storage = new Map<string, string>();

  return {
    clear: vi.fn(() => storage.clear()),
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("project store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageMock());
    useConnectionStore.setState({ activeConnectionId: null });
    useSchemaStore.setState(useSchemaStore.getInitialState(), true);
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    mocks.loadConnections.mockResolvedValue([]);
    mocks.disconnect.mockResolvedValue("ok");
    mocks.getResources.mockResolvedValue([]);
  });

  it("creates and activates a project with a non-ascii name", async () => {
    const project = await useProjectStore.getState().createProject("测试项目");

    expect(project).toMatchObject({
      name: "测试项目",
    });
    expect(project.id).toMatch(/^project-/);
    expect(project.id).not.toBe("sqls");
    expect(mocks.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        id: project.id,
        name: "测试项目",
      })
    );
    expect(useProjectStore.getState()).toMatchObject({
      activeProjectId: project.id,
      activeProjectName: "测试项目",
    });
  });

  it("keeps the active project when a dirty file cannot be discarded", () => {
    useProjectStore.setState({
      projects: [
        { id: "one", name: "One", created_at: 0, updated_at: 0 },
        { id: "two", name: "Two", created_at: 0, updated_at: 0 },
      ],
      activeProjectId: "one",
      activeProjectName: "One",
    });
    const tabId = useTabStore
      .getState()
      .openProjectFileTab("one", "query.sql", "SELECT 1;", "revision-1");
    useTabStore.getState().updateTabSql(tabId, "SELECT 2;");
    vi.stubGlobal("confirm", vi.fn(() => false));

    expect(useProjectStore.getState().setActiveProject("two")).toBe(false);
    expect(useProjectStore.getState().activeProjectId).toBe("one");
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });

  it("keeps the current workspace visible until the target project is ready", async () => {
    const pending = deferred<any[]>();
    mocks.loadConnections.mockReturnValueOnce(pending.promise);
    useProjectStore.setState({
      projects: [
        { id: "one", name: "One", created_at: 0, updated_at: 0 },
        { id: "two", name: "Two", created_at: 0, updated_at: 0 },
      ],
      activeProjectId: "one",
      activeProjectName: "One",
    });
    useConnectionStore.setState({
      connections: [
        { id: "old", name: "Old", driver: "postgres", url: "postgres://old" },
      ],
      activeConnectionId: "old",
      connectedConnectionIds: ["old"],
      isConnected: true,
    });
    useTabStore.setState({
      tabs: [
        {
          id: "tab-old",
          title: "Old query",
          type: "query",
          sql: "SELECT 1",
          isExecuting: false,
          results: [],
          activeResultIndex: 0,
          error: null,
        },
      ],
      activeTabId: "tab-old",
    });
    mocks.getResources.mockResolvedValue([
      {
        id: "new:redis:0",
        project_id: "two",
        connection_id: "new",
        parent_id: null,
        kind: "DATABASE",
        name: "0",
        metadata: { driver: "redis" },
        last_updated: 1,
      },
    ]);

    expect(useProjectStore.getState().setActiveProject("two")).toBe(true);
    expect(useProjectStore.getState().activeProjectId).toBe("one");
    expect(useConnectionStore.getState().connections[0]?.id).toBe("old");
    expect(useTabStore.getState().activeTabId).toBe("tab-old");

    pending.resolve([
      { id: "new", name: "New", driver: "redis", url: "redis://new" },
    ]);
    await pending.promise;
    for (let index = 0; index < 4; index += 1) await Promise.resolve();

    expect(useProjectStore.getState().activeProjectId).toBe("two");
    expect(useConnectionStore.getState().connections[0]).toMatchObject({
      id: "new",
      projectId: "two",
    });
    expect(useConnectionStore.getState().activeConnectionId).toBe("new");
    expect(useConnectionStore.getState().isConnected).toBe(false);
    expect(useSchemaStore.getState().schemas).toEqual(["0"]);
    expect(useSchemaStore.getState().currentSchema).toBe("0");
    expect(mocks.getResources).toHaveBeenCalledWith("new", undefined, "two");
    expect(useTabStore.getState().tabs).toEqual([]);
    expect(mocks.disconnect).toHaveBeenCalledWith("old");
  });
});
