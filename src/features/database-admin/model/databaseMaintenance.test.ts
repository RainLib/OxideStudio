import { describe, expect, it } from "vitest";
import {
  databaseMaintenanceOptions,
  defaultDatabaseMaintenanceOperation,
} from "./databaseMaintenance";

describe("database maintenance operation catalog", () => {
  it("never offers MySQL operations to PostgreSQL", () => {
    expect(databaseMaintenanceOptions("postgres").map(({ value }) => value)).toEqual([
      "analyze",
      "vacuum",
      "vacuumAnalyze",
      "vacuumFull",
      "vacuumFullAnalyze",
    ]);
  });

  it("limits MySQL and MariaDB to their reviewed table operations", () => {
    expect(databaseMaintenanceOptions("mysql").map(({ value }) => value)).toEqual([
      "analyze",
      "optimize",
    ]);
    expect(databaseMaintenanceOptions("mariadb")).toEqual(
      databaseMaintenanceOptions("mysql"),
    );
    expect(defaultDatabaseMaintenanceOperation("mariadb")).toBe("analyze");
  });
});
