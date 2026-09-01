/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveProjectFileTab } from "@/lib/projectFileTabs";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";

describe("project file tab lifecycle", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    localStorage.clear();
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
      isLoading: false,
    });
    useSchemaStore.setState({ currentSchema: null });
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

  it("keeps Agent diff review separate from the editable project file tab", () => {
    const diffId = useTabStore.getState().openAgentFileDiffTab({
      turnId: "turn-1",
      callId: "write-1",
      projectId: "project-1",
      expectedRoot: "C:/workspace/root-a",
      relativePath: "queries/daily.sql",
      operation: "updated",
      proposedRevision: "proposal-revision",
      baseRevision: "revision-1",
      originalContent: "SELECT 1;",
      proposedContent: "SELECT 2;",
      additions: 1,
      deletions: 1,
      status: "pending",
      occurredAt: 1,
    });
    const fileId = useTabStore.getState().openProjectFileTab(
      "project-1",
      "queries/daily.sql",
      "SELECT 1;",
      "revision-1",
      "C:/workspace/root-a",
    );

    expect(fileId).not.toBe(diffId);
    expect(useTabStore.getState().tabs).toHaveLength(2);
    expect(
      useTabStore.getState().tabs.find((tab) => tab.id === diffId),
    ).toMatchObject({
      title: "daily.sql (Diff)",
      agentFileDiffPreview: {
        callId: "write-1",
        proposedContent: "SELECT 2;",
      },
    });
    const fileTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === fileId);
    expect(fileTab?.title).toBe("daily.sql");
    expect(fileTab?.agentFileDiffPreview).toBeUndefined();
  });

  it("binds a SQL file to the active target and restores it after reopening", () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "connection-1",
          name: "Analytics",
          driver: "postgres",
          url: "postgres://localhost/analytics",
          database: "analytics",
        },
      ],
      activeConnectionId: "connection-1",
      isLoading: false,
    });
    useSchemaStore.setState({ currentSchema: "reporting" });

    const firstId = useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "queries/daily.sql",
        "SELECT 1;",
        "revision-1",
      );
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      connectionId: "connection-1",
      databaseName: "analytics",
      schemaName: "reporting",
      targetSchema: "reporting",
    });

    useTabStore.getState().setTargetDatabase(firstId, "warehouse");
    useTabStore.getState().setTargetSchema(firstId, "finance");
    useTabStore.getState().forceCloseTab(firstId);
    useConnectionStore.setState({ activeConnectionId: null });
    useSchemaStore.setState({ currentSchema: null });

    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "queries/daily.sql",
        "SELECT 1;",
        "revision-2",
      );
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      connectionId: "connection-1",
      databaseName: "warehouse",
      schemaName: "finance",
      targetSchema: "finance",
    });
  });

  it("ignores a SQL file target after its connection is deleted", () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "connection-1",
          name: "Analytics",
          driver: "postgres",
          url: "postgres://localhost/analytics",
        },
      ],
      activeConnectionId: "connection-1",
      isLoading: false,
    });
    const firstId = useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "query.sql",
        "SELECT 1;",
        "revision-1",
      );
    useTabStore.getState().forceCloseTab(firstId);
    useConnectionStore.setState({ connections: [], activeConnectionId: null });

    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "query.sql",
        "SELECT 1;",
        "revision-2",
      );
    expect(useTabStore.getState().tabs[0]?.connectionId).toBeUndefined();
  });

  it("keeps non-SQL files unbound and binds them only after a SQL rename", () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "connection-1",
          name: "Analytics",
          driver: "postgres",
          url: "postgres://localhost/analytics",
          database: "analytics",
        },
      ],
      activeConnectionId: "connection-1",
      isLoading: false,
    });
    useSchemaStore.setState({ currentSchema: "reporting" });

    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "notes.txt",
        "notes",
        "revision-1",
      );
    expect(useTabStore.getState().tabs[0]?.connectionId).toBeUndefined();

    useTabStore
      .getState()
      .renameProjectFileTabs("project-1", "notes.txt", "notes.sql");
    useTabStore.getState().closeAllTabs();
    useConnectionStore.setState({ activeConnectionId: null });
    useSchemaStore.setState({ currentSchema: null });
    useTabStore
      .getState()
      .openProjectFileTab(
        "project-1",
        "notes.sql",
        "notes",
        "revision-2",
      );

    expect(useTabStore.getState().tabs[0]).toMatchObject({
      connectionId: "connection-1",
      databaseName: "analytics",
      targetSchema: "reporting",
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
