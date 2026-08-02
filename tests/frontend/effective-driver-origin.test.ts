import { describe, expect, it } from "vitest";
import { connectionUsesExternalDriverPackage } from "@/features/database-drivers";
import type { DatabaseDriverInstallation } from "@/services/tauri/types";

function externalPackage(
  overrides: Partial<DatabaseDriverInstallation> = {},
): DatabaseDriverInstallation {
  return {
    driver: "postgres",
    displayName: "PostgreSQL package",
    clientLibrary: "vendor-pg",
    clientVersion: "1.0.0",
    distribution: "external",
    updatePolicy: "independent",
    independentlyUpdatable: true,
    serverVersionPolicy: "declared",
    implementation: "Verified sidecar",
    runtimeReady: true,
    packageVersion: "1.0.0",
    active: true,
    status: "ready",
    ...overrides,
  };
}

describe("effective external driver origin", () => {
  it("uses a ready active package even when it reuses a bundled driver id", () => {
    expect(
      connectionUsesExternalDriverPackage("postgres", undefined, [externalPackage()]),
    ).toBe(true);
  });

  it("respects an explicit version pin instead of an unrelated active package", () => {
    const installations = [
      externalPackage({ packageVersion: "1.0.0", active: true }),
      externalPackage({ packageVersion: "2.0.0", active: false }),
    ];

    expect(
      connectionUsesExternalDriverPackage("postgres", "2.0.0", installations),
    ).toBe(true);
    expect(
      connectionUsesExternalDriverPackage("postgres", "3.0.0", installations),
    ).toBe(false);
  });

  it("does not treat an untrusted or unavailable runtime as an active package", () => {
    expect(
      connectionUsesExternalDriverPackage("postgres", undefined, [
        externalPackage({ runtimeReady: false }),
      ]),
    ).toBe(false);
    expect(
      connectionUsesExternalDriverPackage("postgres", undefined, [
        externalPackage({ status: "untrusted" }),
      ]),
    ).toBe(false);
  });

  it("normalizes a MariaDB connection against a MySQL-family package", () => {
    expect(
      connectionUsesExternalDriverPackage("mariadb", undefined, [
        externalPackage({ driver: "mysql" }),
      ]),
    ).toBe(true);
  });
});
