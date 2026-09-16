/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { column, mocksForTests as mocks, useTabStore } from "./harness";

describe("table editing store: row mutations and recovery", () => {
  it("consumes inserted row drafts when saving succeeds but refreshing fails", async () => {
    mocks.previewTablePage.mockRejectedValueOnce(new Error("database timeout"));
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "created@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    let tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledTimes(1);
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ email: "created@example.test" }],
      [],
      [],
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
    expect(tab.error).toContain("Changes were saved");
    expect(tab.error).toContain("Click Refresh");
    expect(tab.error).toContain("database timeout");
    expect(tab.error).not.toContain("Save failed");

    await useTabStore.getState().commitEdits("tab-1");

    tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledTimes(1);
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });

  it("inserts an untouched new row using database defaults", async () => {
    mocks.mutateTableRows.mockResolvedValueOnce({
      inserted: 1,
      updated: 0,
      deleted: 0,
      rowsAffected: 1,
    });
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map(),
          newRowsCount: 1,
          tableTotalRows: 10,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{}],
      [],
      [],
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });

  it("submits edited and untouched new rows together", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "created@example.test"]]),
          newRowsCount: 2,
          tableTotalRows: 10,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledTimes(1);
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ email: "created@example.test" }, {}],
      [],
      [],
    );
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
  });

  it("locks table drafts while a save mutation is in flight", async () => {
    let resolveMutation!: (value: {
      inserted: number;
      updated: number;
      deleted: number;
      rowsAffected: number;
    }) => void;
    mocks.mutateTableRows.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "original@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    const savePromise = useTabStore.getState().commitEdits("tab-1");
    expect(useTabStore.getState().tabs[0]?.isExecuting).toBe(true);

    useTabStore
      .getState()
      .setCellEdit("tab-1", -1, 0, "changed-during-save@example.test");
    expect(useTabStore.getState().tabs[0]?.pendingEdits).toEqual(
      new Map([["-1:0", "original@example.test"]]),
    );

    resolveMutation({ inserted: 1, updated: 0, deleted: 0, rowsAffected: 1 });
    await savePromise;
    expect(useTabStore.getState().tabs[0]?.isExecuting).toBe(false);
  });

  it("keeps drafts retryable when the save mutation itself fails", async () => {
    mocks.mutateTableRows.mockRejectedValueOnce(new Error("write rejected"));
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableIndexes: [],
          pendingEdits: new Map([["-1:0", "created@example.test"]]),
          newRowsCount: 1,
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.previewTablePage).not.toHaveBeenCalled();
    expect(tab.pendingEdits).toEqual(
      new Map([["-1:0", "created@example.test"]]),
    );
    expect(tab.newRowsCount).toBe(1);
    expect(tab.error).toBe("Save failed: write rejected");
  });

  it("fetches missing index metadata before saving existing row edits", async () => {
    const columns = [column("email"), column("name")];
    mocks.getColumns.mockResolvedValueOnce(columns);
    mocks.getIndexes.mockResolvedValueOnce([
      {
        name: "users_email_key",
        columns: ["email"],
        is_unique: true,
        is_primary: false,
      },
    ]);

    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: columns,
          tableIndexes: undefined,
          results: [
            {
              columns: [
                { name: "email", data_type: "text" },
                { name: "name", data_type: "text" },
              ],
              rows: [["old@example.test", "Old Name"]],
            },
          ],
          pendingEdits: new Map([["0:1", "New Name"]]),
        },
      ],
    });

    await useTabStore.getState().commitEdits("tab-1");

    expect(mocks.getIndexes).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users",
    );
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [{ key: { email: "old@example.test" }, values: { name: "New Name" } }],
      [],
    );
  });

  it("uses a unique index to delete rows when no primary key exists", async () => {
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [column("email"), column("name")],
          tableIndexes: [
            {
              name: "users_email_key",
              columns: ["email"],
              is_unique: true,
              is_primary: false,
            },
          ],
          results: [
            {
              columns: [
                { name: "email", data_type: "text" },
                { name: "name", data_type: "text" },
              ],
              rows: [["old@example.test", "Old Name"]],
            },
          ],
        },
      ],
    });

    await useTabStore.getState().deleteRows("tab-1", [0]);

    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [],
      [{ key: { email: "old@example.test" } }],
    );
  });

  it("consumes deleted rows locally when deleting succeeds but refreshing fails", async () => {
    mocks.previewTablePage.mockRejectedValueOnce(
      new Error("network unavailable"),
    );
    useTabStore.setState({
      tabs: [
        {
          ...useTabStore.getState().tabs[0]!,
          tableColumns: [column("id", { primary: true }), column("email")],
          tableIndexes: [
            {
              name: "users_pkey",
              columns: ["id"],
              is_unique: true,
              is_primary: true,
            },
          ],
          results: [
            {
              columns: [
                { name: "id", data_type: "int4" },
                { name: "email", data_type: "text" },
              ],
              rows: [
                [1, "first@example.test"],
                [2, "second@example.test"],
              ],
            },
          ],
          tableTotalRows: 2,
          pendingEdits: new Map([["0:1", "deleted-row-draft@example.test"]]),
          newRowsCount: 0,
        },
      ],
    });

    await useTabStore.getState().deleteRows("tab-1", [0]);

    const tab = useTabStore.getState().tabs[0]!;
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [],
      [],
      [{ key: { id: 1 } }],
    );
    expect(tab.results?.[0]?.rows).toEqual([[2, "second@example.test"]]);
    expect(tab.pendingEdits?.size).toBe(0);
    expect(tab.newRowsCount).toBe(0);
    expect(tab.tableTotalRows).toBe(1);
    expect(tab.error).toContain("Rows were deleted");
    expect(tab.error).toContain("Click Refresh");
    expect(tab.error).toContain("network unavailable");
    expect(tab.error).not.toContain("Delete rows failed");
  });
});
