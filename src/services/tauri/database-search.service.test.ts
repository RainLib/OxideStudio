import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import {
  buildDatabaseSearchSql,
  buildSearchResultWhere,
  buildSearchResultWheres,
  executeDatabaseSearch,
} from "./database-search.service";

describe("database search service", () => {
  beforeEach(() => invokeWithInterceptors.mockReset());

  it("binds SQL planning to the live connection identity", async () => {
    const options = {
      schema: "public",
      tableName: "users",
      columns: [
        { name: "email", dataType: "varchar", isPrimaryKey: false },
      ],
      term: "alice",
      limit: 20,
    };
    invokeWithInterceptors.mockResolvedValue({
      sql: "SELECT ...",
      searchableColumns: ["email"],
    });

    await buildDatabaseSearchSql("connection-1", options);

    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "build_database_search_sql",
      { connectionId: "connection-1", options },
    );
  });

  it("keeps result row predicates in the host planner", async () => {
    const options = {
      columns: [{ name: "id", dataType: "bigint", isPrimaryKey: true }],
      resultColumns: ["id"],
      row: [42],
      matchedColumns: [],
    };
    invokeWithInterceptors.mockResolvedValue('"id" = 42');

    await expect(
      buildSearchResultWhere("connection-1", options),
    ).resolves.toBe('"id" = 42');
    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "build_search_result_where",
      { connectionId: "connection-1", options },
    );
  });

  it("executes only the host-generated search command", async () => {
    invokeWithInterceptors.mockResolvedValue({
      searchableColumns: [],
      results: [],
    });

    await executeDatabaseSearch(
      "connection-1",
      { tableName: "users", columns: [], term: "alice", limit: 20 },
      "search-1",
      "app",
    );

    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "execute_database_search",
      {
        connectionId: "connection-1",
        database: "app",
        queryId: "search-1",
        options: {
          tableName: "users",
          columns: [],
          term: "alice",
          limit: 20,
        },
      },
    );
  });

  it("builds result locators in one bounded host call", async () => {
    const options = {
      columns: [{ name: "id", dataType: "bigint", isPrimaryKey: true }],
      resultColumns: ["id"],
      rows: [[1], [2]],
      matchedColumns: [[], []],
    };
    invokeWithInterceptors.mockResolvedValue(["\"id\" = 1", "\"id\" = 2"]);
    await buildSearchResultWheres("connection-1", options);
    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "build_search_result_wheres",
      { connectionId: "connection-1", options },
    );
  });
});
