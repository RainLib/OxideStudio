import type { DatabaseDriver } from "@/services/tauri/types";

export const DEFAULT_DATABASE_DRIVER: DatabaseDriver = "postgres";

// Only bundled SQLite has a static transport declaration. Every external
// package, including DuckDB, must carry its own signed connection-mode
// capability rather than acquiring file access from its display/driver ID.
export const NATIVE_FILE_BASED_DATABASE_DRIVERS = new Set(["sqlite"]);

export function capabilitiesKey(driver: DatabaseDriver | string) {
  return String(driver).trim().toLowerCase();
}
