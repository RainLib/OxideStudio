import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tabState: {} as {
    activeTabId: string | null;
    tabs: Array<Record<string, unknown>>;
  },
  libraryState: {} as {
    projectId: string | null;
    updateQuery: ReturnType<typeof vi.fn>;
  },
  saveProjectFileTab: vi.fn(),
}));

vi.mock("@/store/useTabStore", () => ({
  useTabStore: {
    getState: () => mocks.tabState,
    setState: (updater: (state: typeof mocks.tabState) => typeof mocks.tabState) => {
      mocks.tabState = updater(mocks.tabState);
    },
  },
}));
vi.mock("@/store/useSavedQueryStore", () => ({
  useSavedQueryStore: { getState: () => mocks.libraryState },
}));
vi.mock("@/lib/projectFileTabs", () => ({
  saveProjectFileTab: mocks.saveProjectFileTab,
}));

import { saveEditorFileTab } from "./editorFileSave";

function savedSqlTab(overrides: Record<string, unknown> = {}) {
  return {
    id: "tab-1",
    title: "daily",
    sql: "SELECT 1",
    isDirty: true,
    savedSqlProjectId: "project-1",
    savedSqlFileId: "file-1",
    ...overrides,
  };
}

describe("editor file save routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tabState = { activeTabId: "tab-1", tabs: [savedSqlTab()] };
    mocks.libraryState = {
      projectId: "project-1",
      updateQuery: vi.fn().mockResolvedValue(true),
    };
  });

  it("keeps a cross-project SQL Library tab dirty and reports the mismatch", async () => {
    mocks.libraryState.projectId = "project-2";

    expect(await saveEditorFileTab()).toBe(false);
    expect(mocks.libraryState.updateQuery).not.toHaveBeenCalled();
    expect(mocks.tabState.tabs[0]).toMatchObject({
      isDirty: true,
      fileError: expect.stringContaining("open the SQL Library project"),
    });
  });

  it("clears dirty state only after the library confirms persistence", async () => {
    expect(await saveEditorFileTab()).toBe(true);
    expect(mocks.libraryState.updateQuery).toHaveBeenCalledWith(
      "file-1",
      "daily",
      "SELECT 1",
      expect.any(Object),
    );
    expect(mocks.tabState.tabs[0]).toMatchObject({ isDirty: false, fileError: null });
  });

  it("delegates ordinary project files to the existing save path", async () => {
    mocks.tabState.tabs = [savedSqlTab({ savedSqlFileId: undefined })];
    mocks.saveProjectFileTab.mockResolvedValue(true);

    expect(await saveEditorFileTab()).toBe(true);
    expect(mocks.saveProjectFileTab).toHaveBeenCalledWith("tab-1");
  });
});
