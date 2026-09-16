import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseCapabilities } from "@/services/tauri/types";
import {
  defaultDatabasePort,
  registerDatabaseCapabilities,
} from "@/lib/databaseDialect";
import { createDatabaseDriverCatalog } from "./createDatabaseDriverCatalog";
import { postgresProfile } from "./profiles/postgres";
import {
  resetRuntimeDatabaseCatalogForTests,
  databaseDriverProfile,
} from "./runtimeCatalog";

function capabilities(
  driver: string,
  defaultPort = 5432,
): DatabaseCapabilities {
  return {
    ...postgresProfile.capabilities,
    driver,
    defaultPort,
    commonDataTypes: ["TEXT"],
    tableExportFormats: ["csv"],
  };
}

afterEach(() => resetRuntimeDatabaseCatalogForTests());

describe("database driver catalog ownership", () => {
  it("isolates authoritative driver lists and capabilities between instances", () => {
    const left = createDatabaseDriverCatalog();
    const right = createDatabaseDriverCatalog();
    left.registerRuntimeDatabaseCatalog([capabilities("left-driver", 7001)]);
    right.registerRuntimeDatabaseCatalog([capabilities("right-driver", 7002)]);

    expect(left.supportedDatabaseDrivers()).toEqual(["left-driver"]);
    expect(right.supportedDatabaseDrivers()).toEqual(["right-driver"]);
    expect(
      left.databaseDriverProfile("left-driver").capabilities.defaultPort,
    ).toBe(7001);
    expect(
      right.databaseDriverProfile("left-driver").capabilities.supportsSqlQuery,
    ).toBe(false);

    left.resetRuntimeDatabaseCatalogForTests();
    expect(left.supportedDatabaseDrivers()).not.toContain("left-driver");
    expect(right.supportedDatabaseDrivers()).toEqual(["right-driver"]);
  });

  it("owns copies of registered capability and connection profile arrays", () => {
    const catalog = createDatabaseDriverCatalog();
    const input = capabilities("owned-driver");
    const profile = {
      ...postgresProfile,
      driver: "owned-driver",
      protocolAliases: ["owned-alias"],
      sslModeParamAliases: ["tls"],
      capabilities: {
        ...postgresProfile.capabilities,
        commonDataTypes: ["INTEGER"],
      },
    };
    catalog.registerDatabaseDriverProfile(profile);
    profile.protocolAliases.push("late-alias");
    profile.sslModeParamAliases.push("late-tls");
    profile.capabilities.commonDataTypes.push("LATE_TYPE");
    expect(catalog.databaseDriverProfile("owned-driver")).toMatchObject({
      protocolAliases: ["owned-alias"],
      sslModeParamAliases: ["tls"],
      capabilities: { commonDataTypes: ["INTEGER"] },
    });

    catalog.registerDatabaseCapabilities(input);
    input.commonDataTypes.push("LATE_TYPE");
    input.tableExportFormats?.push("json");
    expect(
      catalog.databaseDriverProfile("owned-driver").capabilities,
    ).toMatchObject({
      commonDataTypes: ["TEXT"],
      tableExportFormats: ["csv"],
    });
  });

  it("keeps compatibility and feature APIs on the same application instance", () => {
    registerDatabaseCapabilities(capabilities("postgres", 6543));
    expect(defaultDatabasePort("postgres")).toBe(6543);
    expect(databaseDriverProfile("postgres").capabilities.defaultPort).toBe(
      6543,
    );
    expect(
      createDatabaseDriverCatalog().databaseDriverProfile("postgres")
        .capabilities.defaultPort,
    ).toBe(5432);
  });
});
