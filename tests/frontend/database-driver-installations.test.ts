import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  databaseService,
  resetDatabaseCapabilityCachesForTests,
} from "@/services/tauri/database.service";
import {
  defaultDatabaseCapabilities,
  resetRuntimeDatabaseCatalogForTests,
} from "@/lib/databaseDialect";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/services/tauri/client", () => ({
  invokeWithInterceptors: mocks.invoke,
}));

describe("database driver installation inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDatabaseCapabilityCachesForTests();
  });
  afterEach(() => {
    resetRuntimeDatabaseCatalogForTests();
    resetDatabaseCapabilityCachesForTests();
  });

  it("loads the backend-reported client versions and update boundary", async () => {
    mocks.invoke.mockResolvedValue([
      {
        driver: "postgres",
        displayName: "PostgreSQL",
        clientLibrary: "sqlx-postgres",
        clientVersion: "0.8.6",
        distribution: "bundled",
        updatePolicy: "application-update",
        independentlyUpdatable: false,
        serverVersionPolicy: "detected-at-connection",
        implementation: "native Rust client",
      },
    ]);

    const installations =
      await databaseService.listDatabaseDriverInstallations();

    expect(mocks.invoke).toHaveBeenCalledWith(
      "list_database_driver_installations",
    );
    expect(installations[0]).toMatchObject({
      driver: "postgres",
      clientVersion: "0.8.6",
      independentlyUpdatable: false,
    });
  });

  it("reads only aggregated external driver runtime metadata", async () => {
    mocks.invoke.mockResolvedValue([
      {
        driver: "oracle",
        packageVersion: "23.3.0",
        connectionCount: 2,
        processIds: [8201, 8202],
        unavailableProcessCount: 0,
        unhealthyConnectionCount: 0,
      },
    ]);

    const runtimes = await databaseService.listExternalDatabaseDriverRuntimes();

    expect(mocks.invoke).toHaveBeenCalledWith(
      "list_external_database_driver_runtimes",
    );
    expect(runtimes).toEqual([
      expect.objectContaining({
        driver: "oracle",
        packageVersion: "23.3.0",
        connectionCount: 2,
        processIds: [8201, 8202],
      }),
    ]);
  });

  it("uses the typed boundary when reading and migrating the driver store", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        activePath: "/Users/example/Library/Application Support/OxideStudio/database-drivers",
        restartRequired: false,
      })
      .mockResolvedValueOnce({
        activePath: "/Volumes/Drivers/oxide-database-drivers",
        restartRequired: true,
      });

    const current = await databaseService.getDatabaseDriverStoreInfo();
    const migrated = await databaseService.migrateDatabaseDriverStore(
      "/Volumes/Drivers/oxide-database-drivers",
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "get_database_driver_store_info",
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "migrate_database_driver_store",
      { destinationPath: "/Volumes/Drivers/oxide-database-drivers" },
    );
    expect(current.restartRequired).toBe(false);
    expect(migrated).toMatchObject({
      activePath: "/Volumes/Drivers/oxide-database-drivers",
      restartRequired: true,
    });
  });

  it("probes an active external package without sending connection secrets", async () => {
    mocks.invoke.mockResolvedValue({
      driver: "clickhouse",
      packageVersion: "1.2.3",
      protocolVersion: "1.0",
      supportsMetadata: true,
      supportsQuery: true,
      supportsCancellation: true,
      supportsTransactions: false,
      supportsDatabaseScopedQueries: true,
      supportsDatabaseCreation: false,
      supportsTableRowMutation: false,
      supportsAgentReadOnlyEnforcement: true,
      supportsReferencingForeignKeys: false,
    });

    const probe = await databaseService.probeExternalDatabaseDriver("clickhouse");

    expect(mocks.invoke).toHaveBeenCalledWith(
      "probe_external_database_driver",
      { driver: "clickhouse" },
    );
    expect(probe).toMatchObject({
      supportsTableRowMutation: false,
      supportsAgentReadOnlyEnforcement: true,
    });
  });

  it("looks up capabilities for the connection-pinned package version", async () => {
    mocks.invoke.mockResolvedValueOnce({
      driver: "trino",
      displayName: "Trino active",
      commonDataTypes: [],
    }).mockResolvedValueOnce({
      driver: "trino",
      displayName: "Trino pinned",
      commonDataTypes: [],
    });

    await databaseService.getDatabaseCapabilities("trino");
    await databaseService.getDatabaseCapabilities("trino", "441.2.0");

    expect(mocks.invoke).toHaveBeenLastCalledWith("get_database_capabilities", {
      driver: "trino",
      packageVersion: "441.2.0",
    });
    expect(defaultDatabaseCapabilities("trino").displayName).toBe("Trino active");
  });

  it("invalidates the active capability cache after switching a driver package", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        driver: "trino",
        displayName: "Trino 441",
        commonDataTypes: [],
      })
      .mockResolvedValueOnce({ current: "442.0.0", previous: "441.0.0" })
      .mockResolvedValueOnce({
        driver: "trino",
        displayName: "Trino 442",
        commonDataTypes: [],
      });

    await databaseService.getDatabaseCapabilities("trino");
    await databaseService.activateExternalDatabaseDriver("trino", "442.0.0");
    const next = await databaseService.getDatabaseCapabilities("trino");

    expect(next.displayName).toBe("Trino 442");
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "activate_external_database_driver",
      { driver: "trino", packageVersion: "442.0.0" },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      3,
      "get_database_capabilities",
      { driver: "trino" },
    );
  });

  it("checks a signed external-driver catalog through the typed Tauri boundary", async () => {
    mocks.invoke.mockResolvedValue({
      sourceUrl: "https://drivers.example.com/catalog.json",
      catalog: {
        schemaVersion: 1,
        packages: [
          {
            driverId: "clickhouse",
            displayName: "ClickHouse",
            packageVersion: "1.2.3",
            protocolVersion: "1.0",
            downloadUrl: "https://drivers.example.com/clickhouse-1.2.3",
            archiveSha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            supportedTargets: ["darwin-arm64"],
            capabilities: {
              driver: "clickhouse",
              displayName: "ClickHouse",
              dataModel: "relational",
              lspLanguageId: "clickhouse",
            },
            conformance: {
              connect: ["24.3"],
              metadata: ["24.3"],
              query: ["24.3"],
              cancellation: ["24.3"],
              mutations: [],
              migration: [],
            },
          },
        ],
      },
    });

    const result = await databaseService.getExternalDatabaseDriverCatalog(
      "https://drivers.example.com/catalog.json",
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "get_external_database_driver_catalog",
      { catalogUrl: "https://drivers.example.com/catalog.json" },
    );
    expect(result.catalog.packages[0]).toMatchObject({
      driverId: "clickhouse",
      packageVersion: "1.2.3",
      capabilities: { lspLanguageId: "clickhouse" },
      conformance: { query: ["24.3"] },
      archiveSha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
  });

  it("installs only an explicitly selected digest-bound catalog release", async () => {
    mocks.invoke.mockResolvedValue({
      driver: "clickhouse",
      displayName: "ClickHouse",
      packageVersion: "1.2.3",
      active: true,
    });

    const installation =
      await databaseService.installExternalDatabaseDriverFromCatalog(
        "https://drivers.example.com/catalog.json",
        "clickhouse",
        "1.2.3",
      );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "install_external_database_driver_from_catalog",
      {
        catalogUrl: "https://drivers.example.com/catalog.json",
        driver: "clickhouse",
        packageVersion: "1.2.3",
        activate: true,
      },
    );
    expect(installation).toMatchObject({
      driver: "clickhouse",
      packageVersion: "1.2.3",
      active: true,
    });
  });

  it("routes typed database administration commands through the Tauri boundary", async () => {
    mocks.invoke.mockResolvedValueOnce([]).mockResolvedValueOnce("done");

    await databaseService.listDatabaseAdminSessions("connection-1", "postgres");
    await databaseService.terminateDatabaseAdminSession(
      "connection-1",
      "postgres",
      "42",
      true,
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      "list_database_admin_sessions",
      { connectionId: "connection-1", driver: "postgres" },
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "terminate_database_admin_session",
      {
        connectionId: "connection-1",
        driver: "postgres",
        sessionId: "42",
        confirmed: true,
      },
    );
  });
});
