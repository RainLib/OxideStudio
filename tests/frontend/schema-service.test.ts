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

  it("keeps migration approval bound to snapshots, plan id, and target fingerprint", async () => {
    const source = {
      version: 1,
      id: "source-1",
      fingerprint: "source-fingerprint",
      projectId: "project-1",
      connectionId: "source-connection",
      connectionName: "Desired",
      driver: "postgres" as const,
      databaseName: "app",
      schemaName: "public",
      capturedAt: 1,
      relations: [],
      warnings: [],
    };
    const expectedTarget = {
      ...source,
      id: "target-1",
      fingerprint: "target-fingerprint",
      connectionId: "target-connection",
      connectionName: "Production",
    };
    const entry = {
      id: "migration-1",
      projectId: "project-1",
      connectionId: "target-connection",
      connectionName: "Production",
      databaseName: "app",
      schemaName: "public",
      planId: "plan-1",
      sourceFingerprint: "source-fingerprint",
      targetFingerprintBefore: "target-fingerprint",
      status: "succeeded",
      startedAt: 10,
      finishedAt: 12,
      statementCount: 1,
      committedStatements: 1,
      preflightResults: [],
      rollback: {
        available: true,
        changeCount: 1,
        requiresManualReview: true,
        sql: "-- rollback",
      },
      verification: {
        matchesSource: true,
        targetFingerprintAfter: "source-fingerprint",
        remainingPlanId: "remaining-0",
        remainingSummary: {
          total: 0,
          safe: 0,
          review: 0,
          destructive: 0,
          blocked: 0,
        },
        warnings: [],
      },
      warnings: [],
    };
    mocks.invoke
      .mockResolvedValueOnce({ success: true, data: entry })
      .mockResolvedValueOnce({ success: true, data: [entry] });

    await schemaService.executeSchemaMigration({
      source,
      expectedTarget,
      expectedPlanId: "plan-1",
      expectedTargetFingerprint: "target-fingerprint",
      confirmationTarget: "Production / app / public",
      allowReview: true,
      allowDestructive: false,
    });
    await schemaService.listSchemaMigrationJournal(
      "project-1",
      "target-connection",
      12,
    );

    expect(mocks.invoke.mock.calls).toEqual([
      [
        "execute_schema_migration",
        {
          request: {
            source,
            expectedTarget,
            expectedPlanId: "plan-1",
            expectedTargetFingerprint: "target-fingerprint",
            confirmationTarget: "Production / app / public",
            allowReview: true,
            allowDestructive: false,
          },
        },
      ],
      [
        "list_schema_migration_journal",
        {
          projectId: "project-1",
          connectionId: "target-connection",
          limit: 12,
        },
      ],
    ]);
  });
});
