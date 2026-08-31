/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  dataGridConditionHistoryScopeKey,
  isDataGridConditionUndoRedoShortcut,
  loadDataGridConditionHistory,
  rememberDataGridConditionHistory,
} from "@/features/data-grid";

const STORAGE_KEY = "oxide.data-grid-condition-history.v1";
const usersScope = {
  connectionId: "Connection-A",
  databaseName: "app",
  schemaName: "public",
  tableName: "users",
};

afterEach(() => localStorage.removeItem(STORAGE_KEY));

describe("data grid condition history", () => {
  it("scopes history to the connection and relation identity", () => {
    expect(dataGridConditionHistoryScopeKey(usersScope)).toBe(
      "connection-a\u0001app\u0001public\u0001users",
    );
    expect(dataGridConditionHistoryScopeKey({ connectionId: "Connection-A" })).toBeNull();
  });

  it("normalizes, deduplicates, and filters applied WHERE conditions", () => {
    rememberDataGridConditionHistory(usersScope, " status = 'active'; ");
    rememberDataGridConditionHistory(usersScope, "created_at >= CURRENT_DATE");
    rememberDataGridConditionHistory(usersScope, "STATUS = 'ACTIVE'");

    expect(loadDataGridConditionHistory(usersScope)).toEqual([
      "STATUS = 'ACTIVE'",
      "created_at >= CURRENT_DATE",
    ]);
    expect(loadDataGridConditionHistory(usersScope, "created")).toEqual([
      "created_at >= CURRENT_DATE",
    ]);
    expect(loadDataGridConditionHistory({ ...usersScope, tableName: "orders" })).toEqual([]);
  });

  it("recovers safely from malformed browser storage", () => {
    localStorage.setItem(STORAGE_KEY, "not json");
    expect(loadDataGridConditionHistory(usersScope)).toEqual([]);
  });

  it("identifies condition-local undo and redo shortcuts", () => {
    expect(isDataGridConditionUndoRedoShortcut({ key: "z", ctrlKey: true })).toBe(true);
    expect(isDataGridConditionUndoRedoShortcut({ key: "Z", metaKey: true })).toBe(true);
    expect(isDataGridConditionUndoRedoShortcut({ key: "y", ctrlKey: true })).toBe(true);
    expect(isDataGridConditionUndoRedoShortcut({ key: "y", metaKey: true })).toBe(false);
    expect(
      isDataGridConditionUndoRedoShortcut({ key: "z", ctrlKey: true, altKey: true }),
    ).toBe(false);
  });
});
