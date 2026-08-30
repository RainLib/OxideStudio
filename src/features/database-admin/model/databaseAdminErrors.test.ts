import { describe, expect, it } from "vitest";
import { databaseAdminErrorPresentation } from "./databaseAdminErrors";

describe("database administration error presentation", () => {
  it("uses the structured host classification", () => {
    const error = Object.assign(new Error("Account cannot read pg_stat_activity"), {
      code: "DATABASE_ADMIN_SESSIONS_PERMISSION_DENIED",
      context: { adminErrorKind: "permissionDenied" },
    });

    expect(databaseAdminErrorPresentation(error)).toMatchObject({
      kind: "permissionDenied",
      title: "Permission required",
      retryable: false,
    });
  });

  it("falls back to stable response codes for older clients", () => {
    expect(
      databaseAdminErrorPresentation({
        code: "DATABASE_ADMIN_METRICS_CONNECTION_UNAVAILABLE",
        message: "Reconnect",
      }),
    ).toMatchObject({
      kind: "connectionUnavailable",
      retryable: true,
      message: "Reconnect",
    });
  });

  it("does not mislabel an unknown failure as a permission problem", () => {
    expect(databaseAdminErrorPresentation(new Error("unexpected row shape"))).toMatchObject({
      kind: "queryFailed",
      title: "Administration request failed",
    });
  });
});
