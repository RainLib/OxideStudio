import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn(async () => undefined),
  getProjects: vi.fn(async () => []),
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

describe("project store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageMock());
    useConnectionStore.setState({ activeConnectionId: null });
    useSchemaStore.setState(useSchemaStore.getInitialState(), true);
    useProjectStore.setState(useProjectStore.getInitialState(), true);
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
});
