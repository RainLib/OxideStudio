import { beforeEach, describe, expect, it, vi } from "vitest";
import { schemaService } from "@/services/tauri/schema.service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("schema service database discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a database command distinct from schema discovery", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ success: true, data: ["app", "analytics"] })
      .mockResolvedValueOnce({ success: true, data: ["public"] });

    await expect(schemaService.getDatabases("connection-1")).resolves.toEqual([
      "app",
      "analytics",
    ]);
    await expect(schemaService.getSchemas("connection-1")).resolves.toEqual([
      "public",
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      ["get_databases", { connectionId: "connection-1" }],
      ["get_schemas", { connectionId: "connection-1" }],
    ]);
  });

  it("passes database separately for database-scoped metadata", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ success: true, data: ["public", "reporting"] })
      .mockResolvedValueOnce({
        success: true,
        data: [{ name: "events", schema: "reporting", type: "BASE TABLE" }],
      })
      .mockResolvedValueOnce({ success: true, data: [{ name: "id" }] })
      .mockResolvedValueOnce({ success: true, data: [{ name: "events_pkey" }] })
      .mockResolvedValueOnce({ success: true, data: [{ name: "events_pkey" }] })
      .mockResolvedValueOnce({ success: true, data: [] });

    await schemaService.getDatabaseSchemas("connection-1", "analytics");
    await schemaService.getDatabaseTables(
      "connection-1",
      "analytics",
      "reporting"
    );
    await schemaService.getDatabaseColumns(
      "connection-1",
      "analytics",
      "reporting",
      "events"
    );
    await schemaService.getDatabaseIndexes(
      "connection-1",
      "analytics",
      "reporting",
      "events"
    );
    await schemaService.getDatabaseConstraints(
      "connection-1",
      "analytics",
      "reporting",
      "events"
    );
    await schemaService.getDatabaseFunctions(
      "connection-1",
      "analytics",
      "reporting"
    );

    expect(mocks.invoke.mock.calls).toEqual([
      [
        "get_database_schemas",
        { connectionId: "connection-1", database: "analytics" },
      ],
      [
        "get_database_tables",
        {
          connectionId: "connection-1",
          database: "analytics",
          schema: "reporting",
        },
      ],
      [
        "get_database_columns",
        {
          connectionId: "connection-1",
          database: "analytics",
          schema: "reporting",
          table: "events",
        },
      ],
      [
        "get_database_indexes",
        {
          connectionId: "connection-1",
          database: "analytics",
          schema: "reporting",
          table: "events",
        },
      ],
      [
        "get_database_constraints",
        {
          connectionId: "connection-1",
          database: "analytics",
          schema: "reporting",
          table: "events",
        },
      ],
      [
        "get_database_functions",
        {
          connectionId: "connection-1",
          database: "analytics",
          schema: "reporting",
        },
      ],
    ]);
  });
});
