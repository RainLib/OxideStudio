/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveProjectFileTab } from "@/lib/projectFileTabs";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";

describe("project file tab lifecycle", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useProjectStore.setState({
      projects: [
        {
          id: "project-1",
          name: "Project",
          root_path: "C:/workspace/root-a",
          created_at: 0,
          updated_at: 0,
        },
      ],
      activeProjectId: "project-1",
      activeProjectName: "Project",
    });
    useProjectFilesStore.setState({
      projectId: "project-1",
      rootPath: "C:/workspace/root-a",
      entriesByDirectory: {},
      expandedDirectories: [],
      loadingDirectories: [],
      documents: {},
      error: null,
      revisionConflict: null,
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("reuses an open project file and tracks dirty and saved revisions", () => {
    const store = useTabStore.getState();
    const firstId = store.openProjectFileTab(
      "project-1",
      "queries/daily.sql",
      "SELECT 1;",
      "revision-1"
    );
    const secondId = useTabStore.getState().openProjectFileTab(
      "project-1",
      "queries/daily.sql",
      "stale disk content",
      "revision-stale"
    );

    expect(secondId).toBe(firstId);
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      title: "daily.sql",
      sql: "SELECT 1;",
      fileRevision: "revision-1",
      isDirty: false,
    });

    useTabStore.getState().updateTabSql(firstId, "SELECT 2;");
    expect(useTabStore.getState().tabs[0]?.isDirty).toBe(true);

    useTabStore.getState().markProjectFileSaved(firstId, "revision-2");
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      fileRevision: "revision-2",
      isDirty: false,
    });
  });

  it("opens image previews as reusable read-only project tabs", async () => {
    const firstId = useTabStore
      .getState()
      .openProjectFilePreviewTab(
        "project-1",
        "images/diagram.png",
        "image/png",
        "aW1hZ2U=",
        "revision-1",
        5,
        "C:/workspace/root-a"
      );
    const secondId = useTabStore
      .getState()
      .openProjectFilePreviewTab(
        "project-1",
        "images/diagram.png",
        "image/png",
        "bmV3LWltYWdl",
        "revision-2",
        9,
        "C:/workspace/root-a"
      );

    expect(secondId).toBe(firstId);
    expect(useTabStore.getState().tabs).toHaveLength(1);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      title: "diagram.png",
      sql: "",
      fileRevision: "revision-2",
      filePreview: {
        kind: "image",
        mediaType: "image/png",
        dataUrl: "data:image/png;base64,bmV3LWltYWdl",
        size: 9,
      },
      isDirty: false,
    });

    useTabStore.getState().updateTabSql(firstId, "must stay read only");
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      sql: "",
      isDirty: false,
    });
    const writeFile = vi.fn();
    useProjectFilesStore.setState({ writeFile });
    await expect(saveProjectFileTab(firstId)).resolves.toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("prevents closing a dirty file when discard is declined", () => {
    const id = useTabStore.getState().openProjectFileTab(
      "project-1",
      "query.sql",
      "SELECT 1;",
      "revision-1"
    );
    useTabStore.getState().updateTabSql(id, "SELECT 2;");
    vi.mocked(confirm).mockReturnValueOnce(false);

    useTabStore.getState().closeTab(id);
    expect(useTabStore.getState().tabs).toHaveLength(1);

    vi.mocked(confirm).mockReturnValueOnce(true);
    useTabStore.getState().closeTab(id);
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("discards open descendants after a confirmed directory deletion", () => {
    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "queries/daily.sql",
        "SELECT 1;",
        "revision-1"
      );
    const keepId = useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "notes.sql",
        "SELECT 2;",
        "revision-2"
      );

    useTabStore
      .getState()
      .discardProjectFileTabs("project-1", "queries");

    expect(useTabStore.getState()).toMatchObject({ activeTabId: keepId });
    expect(useTabStore.getState().tabs.map((tab) => tab.fileRelativePath)).toEqual([
      "notes.sql",
    ]);
  });

  it("discards every project file tab when the project directory changes", () => {
    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "queries/daily.sql",
        "SELECT 1;",
        "revision-1",
        "C:/workspace/root-a"
      );
    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "notes.txt",
        "note",
        "revision-2",
        "C:/workspace/root-a"
      );

    useTabStore.getState().discardProjectFileTabs("project-1", "");

    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("refuses to save a tab through a different project root", async () => {
    const writeFile = vi.fn();
    useProjectFilesStore.setState({ writeFile });
    const tabId = useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "query.sql",
        "SELECT 1;",
        "revision-1",
        "C:/workspace/root-a"
      );
    useTabStore.getState().updateTabSql(tabId, "SELECT 2;");
    useProjectStore.setState((state) => ({
      projects: state.projects.map((project) => ({
        ...project,
        root_path: "C:/workspace/root-b",
      })),
    }));

    await expect(saveProjectFileTab(tabId)).resolves.toBe(false);

    expect(writeFile).not.toHaveBeenCalled();
    expect(useTabStore.getState().tabs[0]?.fileError).toContain(
      "project directory changed"
    );
    expect(useTabStore.getState().tabs[0]?.isDirty).toBe(true);
  });

  it("keeps edits made while a file save is in flight marked dirty", async () => {
    let finishWrite!: (value: { relativePath: string; revision: string }) => void;
    const writeFile = vi.fn(
      () =>
        new Promise<{ relativePath: string; revision: string }>((resolve) => {
          finishWrite = resolve;
        })
    );
    useProjectFilesStore.setState({ writeFile });
    const tabId = useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "query.sql",
        "SELECT 1;",
        "revision-1",
        "C:/workspace/root-a"
      );
    useTabStore.getState().updateTabSql(tabId, "SELECT 2;");

    const save = saveProjectFileTab(tabId);
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    useTabStore.getState().updateTabSql(tabId, "SELECT 3;");
    finishWrite({ relativePath: "query.sql", revision: "revision-2" });

    await expect(save).resolves.toBe(true);
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      sql: "SELECT 3;",
      fileRevision: "revision-2",
      isDirty: true,
    });
  });
});
