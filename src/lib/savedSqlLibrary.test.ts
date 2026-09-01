import { describe, expect, it } from "vitest";
import type {
  SavedSqlFile,
  SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import {
  nextSavedSqlName,
  savedSqlDescendantFolderIds,
  savedSqlTreeRows,
} from "./savedSqlLibrary";

const folder = (
  id: string,
  parentFolderId: string | null,
  orderIndex: number,
): SavedSqlFolder => ({
  id,
  projectId: "sqls",
  connectionId: "postgres-1",
  parentFolderId,
  name: id,
  orderIndex,
  createdAt: 1,
  updatedAt: 1,
});

const file = (id: string, folderId: string | null, name = `${id}.sql`): SavedSqlFile => ({
  id,
  projectId: "sqls",
  connectionId: "postgres-1",
  folderId,
  name,
  databaseName: "app",
  schemaName: "public",
  sql: "",
  sqlLoaded: false,
  orderIndex: 0,
  openCount: 0,
  openedAt: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("SQL Library tree", () => {
  const folders = [folder("reports", null, 1), folder("daily", "reports", 0)];
  const files = [file("orders", "daily", "Revenue orders.sql"), file("scratch", null)];

  it("keeps collapsed branches hidden while retaining unfiled rows", () => {
    expect(
      savedSqlTreeRows({
        folders,
        files,
        collapsedFolderIds: new Set(["reports", "daily"]),
      }).map((row) => (row.kind === "folder" ? row.folder.id : row.file.id)),
    ).toEqual(["reports", "scratch"]);
  });

  it("force-expands matching ancestors without mutating collapse state", () => {
    const collapsed = new Set(["reports", "daily"]);
    expect(
      savedSqlTreeRows({ folders, files, collapsedFolderIds: collapsed, query: "revenue" }).map(
        (row) => (row.kind === "folder" ? row.folder.id : row.file.id),
      ),
    ).toEqual(["reports", "daily", "orders"]);
    expect([...collapsed]).toEqual(["reports", "daily"]);
  });

  it("collects a complete descendant closure and creates deterministic copy names", () => {
    expect([...savedSqlDescendantFolderIds(folders, "reports")].sort()).toEqual([
      "daily",
      "reports",
    ]);
    expect(nextSavedSqlName("orders", ["orders.sql", "orders (2).sql"])).toBe(
      "orders (3).sql",
    );
  });
});
