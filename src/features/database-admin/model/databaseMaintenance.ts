import type {
  DatabaseDriver,
  DatabaseMaintenanceOperation,
} from "@/services/tauri/types";

export interface DatabaseMaintenanceOption {
  value: DatabaseMaintenanceOperation;
  label: string;
  description: string;
}

const POSTGRES_MAINTENANCE_OPTIONS: readonly DatabaseMaintenanceOption[] = [
  {
    value: "analyze",
    label: "ANALYZE",
    description: "Refresh planner statistics",
  },
  {
    value: "vacuum",
    label: "VACUUM",
    description: "Clean dead tuples and reclaim reusable storage",
  },
  {
    value: "vacuumAnalyze",
    label: "VACUUM ANALYZE",
    description: "Clean dead tuples and refresh planner statistics",
  },
  {
    value: "vacuumFull",
    label: "VACUUM FULL",
    description: "Rewrite the table and return disk space",
  },
  {
    value: "vacuumFullAnalyze",
    label: "VACUUM FULL ANALYZE",
    description: "Rewrite the table and refresh planner statistics",
  },
];

const MYSQL_MAINTENANCE_OPTIONS: readonly DatabaseMaintenanceOption[] = [
  {
    value: "analyze",
    label: "ANALYZE TABLE",
    description: "Refresh optimizer statistics",
  },
  {
    value: "optimize",
    label: "OPTIMIZE TABLE",
    description: "Reorganize table storage and refresh statistics",
  },
];

export function databaseMaintenanceOptions(
  driver: DatabaseDriver,
): readonly DatabaseMaintenanceOption[] {
  return driver === "postgres"
    ? POSTGRES_MAINTENANCE_OPTIONS
    : MYSQL_MAINTENANCE_OPTIONS;
}

export function defaultDatabaseMaintenanceOperation(
  _driver: DatabaseDriver,
): DatabaseMaintenanceOperation {
  return "analyze";
}
