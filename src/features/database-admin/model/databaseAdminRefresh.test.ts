import { describe, expect, it } from "vitest";
import {
  DATABASE_ADMIN_AUTO_REFRESH_MS,
  supportsDatabaseAdminAutoRefresh,
  type DatabaseAdminView,
} from "./databaseAdminRefresh";

describe("database administration refresh policy", () => {
  it("refreshes only read-only live views", () => {
    const views: DatabaseAdminView[] = [
      "sessions",
      "metrics",
      "locks",
      "users",
      "roles",
      "privileges",
    ];

    expect(views.filter(supportsDatabaseAdminAutoRefresh)).toEqual([
      "sessions",
      "metrics",
      "locks",
    ]);
  });

  it("uses a bounded human-observable interval", () => {
    expect(DATABASE_ADMIN_AUTO_REFRESH_MS).toBe(10_000);
  });
});
