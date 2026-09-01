import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedSqlFile } from "@/services/tauri/saved-sql.service";

const service = vi.hoisted(() => ({
  loadLibrary: vi.fn(),
  loadFile: vi.fn(),
  loadFiles: vi.fn(),
  saveFolder: vi.fn(),
  deleteFolder: vi.fn(),
  saveFile: vi.fn(),
  saveBatch: vi.fn(),
  deleteFile: vi.fn(),
  recordOpened: vi.fn(),
}));

vi.mock("@/services/tauri/saved-sql.service", () => ({ savedSqlService: service }));

import { useSavedQueryStore } from "./useSavedQueryStore";

const summary = (id: string): SavedSqlFile => ({
  id,
  projectId: "sqls",
  connectionId: null,
  folderId: null,
  name: `${id}.sql`,
  databaseName: null,
  schemaName: null,
  sql: "",
  sqlLoaded: false,
  orderIndex: 0,
  openCount: 0,
  openedAt: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("saved SQL project store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    localStorage.clear();
    useSavedQueryStore.setState({
      projectId: null,
      folders: [],
      files: [],
      savedQueries: [],
      isLoading: false,
      error: null,
    });
  });

  it("loads only summaries and hydrates content on first open", async () => {
    const file = summary("orders");
    service.loadLibrary.mockResolvedValue({ folders: [], files: [file] });
    service.loadFile.mockResolvedValue({ ...file, sql: "SELECT 1", sqlLoaded: true });
    service.recordOpened.mockResolvedValue(undefined);

    await useSavedQueryStore.getState().loadProject("sqls");
    expect(useSavedQueryStore.getState().files[0]).toMatchObject({
      sql: "",
      sqlLoaded: false,
    });
    const opened = await useSavedQueryStore.getState().openFile(file.id);
    expect(service.loadFile).toHaveBeenCalledWith("sqls", file.id);
    expect(opened?.sql).toBe("SELECT 1");
    expect(useSavedQueryStore.getState().files[0]!.openCount).toBe(1);
  });

  it("migrates the legacy flat store only after backend persistence succeeds", async () => {
    localStorage.setItem(
      "saved-queries",
      JSON.stringify({
        state: {
          savedQueries: [
            { id: "legacy", name: "daily", sql: "SELECT now()", timestamp: 10 },
          ],
        },
      }),
    );
    service.loadLibrary
      .mockResolvedValueOnce({ folders: [], files: [] })
      .mockResolvedValueOnce({ folders: [], files: [summary("legacy")] });
    service.saveBatch.mockResolvedValue(undefined);

    await useSavedQueryStore.getState().loadProject("sqls");
    expect(service.saveBatch).toHaveBeenCalledWith(
      [],
      [expect.objectContaining({ id: "legacy", name: "daily.sql", sql: "SELECT now()" })],
    );
    expect(localStorage.getItem("saved-queries")).toBeNull();
    expect(useSavedQueryStore.getState().files).toHaveLength(1);
  });

  it("does not overwrite a library item when a completed legacy migration key remains", async () => {
    localStorage.setItem(
      "saved-queries",
      JSON.stringify({
        state: {
          savedQueries: [
            { id: "legacy", name: "daily", sql: "SELECT old", timestamp: 10 },
          ],
        },
      }),
    );
    const migrated = summary("legacy");
    service.loadLibrary.mockResolvedValue({ folders: [], files: [migrated] });

    await useSavedQueryStore.getState().loadProject("sqls");

    expect(service.saveBatch).not.toHaveBeenCalled();
    expect(localStorage.getItem("saved-queries")).toBeNull();
    expect(useSavedQueryStore.getState().files).toEqual([migrated]);
  });

  it("discards a late response from the previous project", async () => {
    let resolveFirst: ((value: { folders: []; files: SavedSqlFile[] }) => void) | undefined;
    service.loadLibrary
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce({ folders: [], files: [{ ...summary("new"), projectId: "new" }] });

    const first = useSavedQueryStore.getState().loadProject("old");
    const second = useSavedQueryStore.getState().loadProject("new");
    await second;
    resolveFirst?.({ folders: [], files: [{ ...summary("old"), projectId: "old" }] });
    await first;

    expect(useSavedQueryStore.getState().projectId).toBe("new");
    expect(useSavedQueryStore.getState().files[0]!.id).toBe("new");
  });

  it("imports a directory through one atomic backend batch", async () => {
    service.loadLibrary.mockResolvedValue({ folders: [], files: [] });
    service.saveBatch.mockResolvedValue(undefined);
    await useSavedQueryStore.getState().loadProject("sqls");

    const result = await useSavedQueryStore.getState().importEntries([
      { relativePath: "reports/daily.sql", sql: "SELECT 1" },
      { relativePath: "reports/monthly.sql", sql: "SELECT 2" },
    ], "connection-1");

    expect(result).toEqual({ folderCount: 1, fileCount: 2 });
    expect(service.saveBatch).toHaveBeenCalledTimes(1);
    const [folders, files] = service.saveBatch.mock.calls[0]!;
    expect(folders).toHaveLength(1);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      folderId: folders[0].id,
      connectionId: "connection-1",
      name: "daily.sql",
    });
    expect(useSavedQueryStore.getState().files).toHaveLength(2);
  });

  it("keeps root file names independent across connection scopes", async () => {
    const existing = {
      ...summary("existing"),
      connectionId: "connection-1",
      name: "daily.sql",
    };
    service.loadLibrary.mockResolvedValue({ folders: [], files: [existing] });
    service.saveBatch.mockResolvedValue(undefined);
    await useSavedQueryStore.getState().loadProject("sqls");

    await useSavedQueryStore.getState().importEntries(
      [{ relativePath: "daily.sql", sql: "SELECT 2" }],
      "connection-2",
    );

    const [, files] = service.saveBatch.mock.calls[0]!;
    expect(files[0].name).toBe("daily.sql");
  });

  it("hydrates all SQL content with one backend request for export", async () => {
    const file = summary("orders");
    service.loadLibrary.mockResolvedValue({ folders: [], files: [file] });
    service.loadFiles.mockResolvedValue([
      { ...file, sql: "SELECT * FROM orders", sqlLoaded: true },
    ]);
    await useSavedQueryStore.getState().loadProject("sqls");

    const files = await useSavedQueryStore.getState().ensureAllFileContents();

    expect(service.loadFiles).toHaveBeenCalledOnce();
    expect(files[0]!.sql).toBe("SELECT * FROM orders");
  });
});
