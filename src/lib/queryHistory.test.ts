import { describe, expect, it } from "vitest";
import {
  queryHistoryDisplayTitle,
  queryHistoryForScope,
  type QueryHistoryItem,
} from "./queryHistory";

function historyItem(
  id: string,
  overrides: Partial<QueryHistoryItem> = {},
): QueryHistoryItem {
  return {
    id,
    projectId: "project-1",
    connectionId: "connection-1",
    connectionName: "Local",
    driver: "postgres",
    databaseName: "app",
    schemaName: "public",
    sql: `select '${id}'`,
    status: "success",
    durationMs: 10,
    rowCount: 1,
    errorMessage: null,
    executionMode: "statement",
    startedAt: Number(id.replace(/\D/g, "")) || 1,
    finishedAt: Number(id.replace(/\D/g, "")) || 1,
    ...overrides,
  };
}

describe("queryHistoryForScope", () => {
  it("filters by connection, database, and schema without leaking other contexts", () => {
    const history = [
      historyItem("4", { connectionId: "connection-2" }),
      historyItem("3", { databaseName: "warehouse" }),
      historyItem("2", { schemaName: "audit" }),
      historyItem("1"),
    ];

    expect(
      queryHistoryForScope(history, {
        connectionId: "connection-1",
        databaseName: "APP",
        schemaName: "Public",
      }).map((item) => item.id),
    ).toEqual(["1"]);
  });

  it("treats omitted descendants as a broader connection scope", () => {
    const history = [
      historyItem("1"),
      historyItem("3", { databaseName: "warehouse" }),
      historyItem("2", { schemaName: "audit" }),
    ];

    expect(
      queryHistoryForScope(history, { connectionId: "connection-1" }).map(
        (item) => item.id,
      ),
    ).toEqual(["3", "2", "1"]);
  });

  it("keeps the newest equivalent SQL and respects the result limit", () => {
    const history = [
      historyItem("3", { sql: " SELECT  * FROM users " }),
      historyItem("2", { sql: "select *   from users" }),
      historyItem("1", { sql: "select * from teams" }),
    ];

    expect(
      queryHistoryForScope(history, { connectionId: "connection-1" }, 2).map(
        (item) => item.id,
      ),
    ).toEqual(["3", "1"]);
  });
});

describe("queryHistoryDisplayTitle", () => {
  it("uses the first non-empty line and truncates it", () => {
    expect(
      queryHistoryDisplayTitle({ sql: "\n  select   * from users\n" }),
    ).toBe("select * from users");
    expect(queryHistoryDisplayTitle({ sql: "abcdefgh" }, 6)).toBe(
      "abcde\u2026",
    );
    expect(queryHistoryDisplayTitle({ sql: "   \n" })).toBe("Untitled query");
  });
});
