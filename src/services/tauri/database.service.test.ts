import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import {
  executeDatabaseMaintenance,
  executeSqliteBackupPlan,
  executeDatabaseAdminEventMutation,
  cancelSqliteBackupRun,
  deleteSqliteBackupRun,
  deleteSqliteBackupSchedule,
  getDatabaseAdminServerIdentity,
  previewDatabaseMaintenance,
  previewSqliteBackupPlan,
  previewDatabaseAdminEventMutation,
  listDatabaseAdminEvents,
  listSqliteBackupRuns,
  listSqliteBackupSchedules,
  runDueSqliteBackupSchedules,
  runSqliteBackupSchedule,
  saveSqliteBackupSchedule,
} from "./database.service";

describe("database administration service", () => {
  beforeEach(() => {
    invokeWithInterceptors.mockReset();
  });

  it("asks the host to confirm identity for the selected live connection", async () => {
    invokeWithInterceptors.mockResolvedValue({
      driver: "postgres",
      database: "warehouse",
      account: "operator",
      serverVersion: "16.4",
    });

    await expect(
      getDatabaseAdminServerIdentity("connection-1", "postgres"),
    ).resolves.toMatchObject({ database: "warehouse" });
    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "get_database_admin_server_identity",
      { connectionId: "connection-1", driver: "postgres" },
    );
  });

  it("keeps maintenance preview and execution behind typed host commands", async () => {
    const maintenance = {
      database: "warehouse",
      schema: "public",
      table: "events",
      operation: "vacuumFull" as const,
    };
    invokeWithInterceptors
      .mockResolvedValueOnce({
        target: "warehouse.public.events",
        confirmationToken: "sha256:plan",
      })
      .mockResolvedValueOnce("Maintenance completed");

    await previewDatabaseMaintenance("connection-1", "postgres", maintenance);
    await executeDatabaseMaintenance("connection-1", "postgres", {
      maintenance,
      confirmationToken: "sha256:plan",
      confirmationText: "VACUUM FULL warehouse.public.events",
    });

    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      1,
      "preview_database_maintenance",
      { connectionId: "connection-1", driver: "postgres", request: maintenance },
    );
    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      2,
      "execute_database_maintenance",
      {
        connectionId: "connection-1",
        driver: "postgres",
        request: {
          maintenance,
          confirmationToken: "sha256:plan",
          confirmationText: "VACUUM FULL warehouse.public.events",
        },
      },
    );
  });

  it("keeps SQLite backup and restore behind reviewed host plans", async () => {
    const plan = {
      operation: "restore" as const,
      path: "C:/backups/app.sqlite",
    };
    invokeWithInterceptors
      .mockResolvedValueOnce({
        fileName: "app.sqlite",
        confirmationToken: "sha256:restore",
      })
      .mockResolvedValueOnce({
        operation: "restore",
        integrityCheck: "ok",
      });

    await previewSqliteBackupPlan("connection-1", plan);
    await executeSqliteBackupPlan("connection-1", {
      plan,
      confirmationToken: "sha256:restore",
      confirmationText: "RESTORE SQLITE FROM app.sqlite",
    });

    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      1,
      "preview_sqlite_backup_plan",
      { connectionId: "connection-1", request: plan },
    );
    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      2,
      "execute_sqlite_backup_plan",
      {
        connectionId: "connection-1",
        request: {
          plan,
          confirmationToken: "sha256:restore",
          confirmationText: "RESTORE SQLITE FROM app.sqlite",
        },
      },
    );
  });

  it("keeps scheduled event mutations behind live metadata review", async () => {
    const mutation = {
      action: "setEnabled" as const,
      schema: "shop",
      name: "daily_sync",
      enabled: false,
    };
    invokeWithInterceptors
      .mockResolvedValueOnce({
        schedulerStatus: "ON",
        events: [{ schema: "shop", name: "daily_sync" }],
      })
      .mockResolvedValueOnce({ confirmationToken: "event-plan" })
      .mockResolvedValueOnce("Event disable completed");

    await listDatabaseAdminEvents("connection-1", "mysql", "shop");
    await previewDatabaseAdminEventMutation(
      "connection-1",
      "mysql",
      mutation,
    );
    await executeDatabaseAdminEventMutation("connection-1", "mysql", {
      mutation,
      confirmationToken: "event-plan",
      confirmationText: "DISABLE EVENT shop.daily_sync",
    });

    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      1,
      "list_database_admin_events",
      { connectionId: "connection-1", driver: "mysql", schema: "shop" },
    );
    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      2,
      "preview_database_admin_event_mutation",
      { connectionId: "connection-1", driver: "mysql", mutation },
    );
    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      3,
      "execute_database_admin_event_mutation",
      {
        connectionId: "connection-1",
        driver: "mysql",
        request: {
          mutation,
          confirmationToken: "event-plan",
          confirmationText: "DISABLE EVENT shop.daily_sync",
        },
      },
    );
  });

  it("uses typed host commands for the complete SQLite schedule lifecycle", async () => {
    const schedule = {
      name: "Nightly app",
      projectId: "project-1",
      connectionId: "sqlite-1",
      destinationDirectory: "C:/backups",
      frequency: "daily" as const,
      intervalHours: 24,
      timeOfDay: "02:00",
      weekday: 1,
      retentionCount: 7,
      enabled: true,
    };
    invokeWithInterceptors.mockResolvedValue(undefined);

    await listSqliteBackupSchedules();
    await saveSqliteBackupSchedule(schedule);
    await listSqliteBackupRuns();
    await runSqliteBackupSchedule("schedule-1");
    await runDueSqliteBackupSchedules();
    await cancelSqliteBackupRun("run-1");
    await deleteSqliteBackupRun("run-1");
    await deleteSqliteBackupSchedule("schedule-1");

    expect(invokeWithInterceptors.mock.calls).toEqual([
      ["list_sqlite_backup_schedules"],
      ["save_sqlite_backup_schedule", { request: schedule }],
      ["list_sqlite_backup_runs"],
      [
        "run_sqlite_backup_schedule",
        { request: { scheduleId: "schedule-1", trigger: "manual" } },
      ],
      ["run_due_sqlite_backup_schedules"],
      ["cancel_sqlite_backup_run", { request: { id: "run-1" } }],
      ["delete_sqlite_backup_run", { request: { id: "run-1" } }],
      ["delete_sqlite_backup_schedule", { request: { id: "schedule-1" } }],
    ]);
  });
});
