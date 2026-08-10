import { afterEach, describe, expect, it } from "vitest";
import {
  connectionDatabaseNamespacePreference,
  defaultDatabaseCapabilities,
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
  queryEditorLanguageIdForCapabilities,
  supportsSqlRelationMetadataLsp,
  supportsTableWorkspace,
  isFileBasedDatabaseDriver,
  lspLanguageId,
  quoteIdentifierWithCapabilities,
  resetRuntimeDatabaseCatalogForTests,
  supportsLspLanguageId,
  supportsLspCapabilities,
  supportedDatabaseDriverProfiles,
  syncExternalDatabaseDriverProfiles,
  selectPreferredNamespace,
} from "@/lib/databaseDialect";
import { buildConnectionUrl, parseConnectionUrl } from "@/lib/connectionUrlParser";
import { REFERENCE_DATABASE_DRIVER_CANDIDATES } from "@/features/database-drivers";

describe("database dialect capabilities", () => {
  it("keeps SQL Server catalog names separate from its dbo schema default", () => {
    expect(
      connectionDatabaseNamespacePreference("sqlserver", "warehouse"),
    ).toBeNull();
    expect(
      selectPreferredNamespace("sqlserver", ["sys", "sales", "DBO"]),
    ).toBe("DBO");
    expect(
      selectPreferredNamespace("sqlserver", ["dbo", "sales"], ["sales"]),
    ).toBe("sales");
    expect(
      connectionDatabaseNamespacePreference("mysql", "warehouse"),
    ).toBe("warehouse");
  });

  it("renders declared asymmetric identifier delimiters without corrupting SQL", () => {
    expect(
      quoteIdentifierWithCapabilities({ identifierQuote: "[" }, "order] detail"),
    ).toBe("[order]] detail]");
    expect(
      quoteIdentifierWithCapabilities({ identifierQuote: '"' }, 'order" detail'),
    ).toBe('"order"" detail"');
  });

  it("keeps unknown driver ids inert until an active package declares their contract", () => {
    expect(defaultDatabaseCapabilities("uninstalled-enterprise-db")).toMatchObject({
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsTableRowMutation: false,
      supportsTransactions: false,
    });
  });

  afterEach(() => resetRuntimeDatabaseCatalogForTests());
  it("exposes MongoDB indexes to metadata, LSP, and snapshot consumers", () => {
    expect(defaultDatabaseCapabilities("mongodb").supportsTableIndexes).toBe(
      true,
    );
  });

  it("enables Explain Plan only for supported relational drivers", () => {
    expect(defaultDatabaseCapabilities("postgres").supportsExplainPlan).toBe(
      true,
    );
    expect(defaultDatabaseCapabilities("mysql").supportsExplainPlan).toBe(true);
    expect(defaultDatabaseCapabilities("redis").supportsExplainPlan).toBe(
      false,
    );
    expect(defaultDatabaseCapabilities("mongodb").supportsExplainPlan).toBe(
      false,
    );
    expect(
      defaultDatabaseCapabilities("elasticsearch").supportsExplainPlan,
    ).toBe(false);
  });

  it("keeps table export formats explicit and isolated per driver", () => {
    expect(defaultDatabaseCapabilities("postgres").tableExportFormats).toEqual([
      "csv",
      "json",
      "jsonl",
      "markdown",
      "sql",
      "tsv",
      "xlsx",
      "parquet",
      "arrow",
    ]);
    expect(defaultDatabaseCapabilities("redis").tableExportFormats).toEqual([]);
    expect(
      defaultDatabaseCapabilities("uninstalled-enterprise-db")
        .tableExportFormats,
    ).toEqual([]);
  });

  it("keeps namespace creation options capability-driven", () => {
    expect(defaultDatabaseCapabilities("postgres")).toMatchObject({
      supportsCreateDatabase: true,
      supportsCreateDatabaseOwner: true,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
    });
    expect(defaultDatabaseCapabilities("mysql")).toMatchObject({
      supportsCreateDatabase: true,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: true,
      supportsCreateDatabaseCollation: true,
    });
  });

  it("keeps SQLite in the relational Explorer path without inventing a server port", () => {
    expect(defaultDatabaseCapabilities("sqlite")).toMatchObject({
      dataModel: "relational",
      defaultPort: 0,
      supportsTableBrowsing: true,
      supportsTableRowMutation: true,
      supportsTableDdl: true,
      supportsTransactions: true,
      supportsExplainPlan: false,
      connectionMode: "file",
      supportsDatabaseCatalogs: false,
      supportsColumnAlteration: false,
      supportsIndexRename: false,
      supportsConstraintAlteration: false,
    });
    expect(isFileBasedDatabaseDriver("sqlite")).toBe(true);
    expect(supportsLspLanguageId("sqlite")).toBe(true);
  });

  it("keeps fine-grained table editing behind the declared driver contract", () => {
    expect(defaultDatabaseCapabilities("postgres")).toMatchObject({
      supportsColumnAlteration: true,
      supportsIndexRename: true,
      supportsConstraintAlteration: true,
    });
    expect(defaultDatabaseCapabilities("mysql")).toMatchObject({
      supportsColumnAlteration: true,
      supportsIndexRename: true,
      supportsConstraintAlteration: true,
    });
  });

  it("adds only verified external packages to the selectable driver catalog", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "clickhouse",
        displayName: "ClickHouse",
        clientLibrary: "clickhouse-rs",
        clientVersion: "0.13",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: ">=22",
        implementation: "isolated driver sidecar",
        packageVersion: "1.2.3",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          driver: "clickhouse",
          displayName: "ClickHouse",
          dataModel: "relational",
          lspLanguageId: "sql",
          lspServerDialect: "clickhouse",
          namespaceLabel: "database",
          identifierQuote: "`",
          defaultPort: 8123,
          supportsSqlQuery: true,
          supportsTableBrowsing: true,
          supportsCollectionBrowsing: false,
          supportsKeyValueBrowsing: false,
          supportsSchemas: true,
          supportsCreateDatabase: false,
          supportsCreateDatabaseCharset: false,
          supportsColumnComments: false,
          supportsInlineColumnComments: false,
          supportsRenameDatabase: false,
          supportsViews: true,
          supportsReplaceView: false,
          supportsMaterializedViews: true,
          supportsTableIndexes: false,
          supportsTableConstraints: false,
          supportsForeignKeys: false,
          supportsCheckConstraints: false,
          supportsFunctions: true,
          supportsTransactions: false,
          supportsQueryCancellation: true,
          supportsExplainPlan: true,
          autoIncrementKeyword: null,
          defaultPrimaryKeyType: "UInt64",
          commonDataTypes: ["UInt64", "String"],
        },
      },
      {
        driver: "untrusted-driver",
        displayName: "Untrusted",
        clientLibrary: "fixture",
        clientVersion: "1",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: false,
        status: "untrusted",
      },
    ]);

    expect(
      supportedDatabaseDriverProfiles().some(
        (profile) => profile.driver === "clickhouse",
      ),
    ).toBe(true);
    expect(defaultDatabaseCapabilities("clickhouse")).toMatchObject({
      dataModel: "relational",
      defaultPort: 8123,
      supportsTransactions: false,
      supportsMaterializedViews: true,
    });
    expect(supportsLspLanguageId("clickhouse")).toBe(true);
    expect(lspLanguageId("clickhouse")).toBe("sql");
    expect(
      lspServerDialectForCapabilities(
        defaultDatabaseCapabilities("clickhouse"),
      ),
    ).toBe("clickhouse");
    expect(
      supportedDatabaseDriverProfiles().some(
        (profile) => profile.driver === "untrusted-driver",
      ),
    ).toBe(false);
  });

  it("falls back to generic SQL intelligence for a verified relational dialect", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "oracle",
        displayName: "Oracle Database",
        clientLibrary: "fixture",
        clientVersion: "1.0",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("postgres"),
          driver: "oracle",
          displayName: "Oracle Database",
          lspLanguageId: "oracle",
        },
      },
    ]);

    expect(supportsLspLanguageId("oracle")).toBe(true);
    expect(lspLanguageId("oracle")).toBe("sql");
  });

  it("keeps generic SQL UI while honoring a reviewed MySQL-compatible parser baseline", () => {
    const mysqlCompatible = {
      ...defaultDatabaseCapabilities("postgres"),
      driver: "doris",
      displayName: "Apache Doris",
      lspLanguageId: "sql",
      lspServerDialect: "mysql",
    };

    expect(lspLanguageIdForCapabilities(mysqlCompatible)).toBe("sql");
    expect(lspServerDialectForCapabilities(mysqlCompatible)).toBe("mysql");
    expect(queryEditorLanguageIdForCapabilities(mysqlCompatible)).toBe("sql");
    expect(
      lspServerDialectForCapabilities({
        ...mysqlCompatible,
        lspServerDialect: "unreviewed-vendor-parser",
      }),
    ).toBe("postgres");
  });

  it("retains a reviewed vendor compatibility identity for the bundled LSP registry", () => {
    const oracleCompatible = {
      ...defaultDatabaseCapabilities("postgres"),
      driver: "oracle",
      displayName: "Oracle Database",
      lspLanguageId: "sql",
      lspServerDialect: "oracle",
    };

    expect(lspLanguageIdForCapabilities(oracleCompatible)).toBe("sql");
    expect(lspServerDialectForCapabilities(oracleCompatible)).toBe("oracle");
    expect(queryEditorLanguageIdForCapabilities(oracleCompatible)).toBe("sql");

    expect(
      lspServerDialectForCapabilities({
        ...oracleCompatible,
        driver: "db2",
        displayName: "IBM Db2",
        lspServerDialect: "db2",
      }),
    ).toBe("db2");
  });

  it("uses a connection-pinned capability contract for editor and LSP routing", () => {
    const pinned = {
      ...defaultDatabaseCapabilities("postgres"),
      lspLanguageId: "clickhouse",
    };

    expect(supportsLspCapabilities(pinned)).toBe(true);
    expect(lspLanguageIdForCapabilities(pinned)).toBe("clickhouse");
    expect(queryEditorLanguageIdForCapabilities(pinned)).toBe("sql");
  });

  it("allows a signed SQL-shaped time-series package into generic completion without exposing a relational grid", () => {
    const timeSeries = {
      ...defaultDatabaseCapabilities("postgres"),
      driver: "questdb",
      displayName: "QuestDB",
      dataModel: "timeSeries" as const,
      lspLanguageId: "sql",
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
    };

    expect(supportsLspCapabilities(timeSeries)).toBe(true);
    expect(lspLanguageIdForCapabilities(timeSeries)).toBe("sql");
    expect(lspServerDialectForCapabilities(timeSeries)).toBe("postgres");
    expect(queryEditorLanguageIdForCapabilities(timeSeries)).toBe("sql");
    expect(supportsSqlRelationMetadataLsp(timeSeries)).toBe(true);
    expect(supportsTableWorkspace(timeSeries)).toBe(false);
  });

  it("keeps DBX SQL-shaped search and time-series candidates on the editor-only route", () => {
    for (const driver of ["manticoresearch", "questdb"]) {
      const candidate = REFERENCE_DATABASE_DRIVER_CANDIDATES.find(
        (entry) => entry.driver === driver,
      );
      if (!candidate) throw new Error(`Missing ${driver} reference candidate`);
      const capabilities = {
        ...defaultDatabaseCapabilities("postgres"),
        driver: candidate.driver,
        displayName: candidate.displayName,
        dataModel: candidate.dataModel,
        lspLanguageId: candidate.genericLspLanguageId || "vendor-dsl",
        supportsSqlQuery: true,
        supportsTableBrowsing: true,
        supportsTableRowMutation: false,
        supportsTableDdl: false,
      };

      expect(supportsLspCapabilities(capabilities)).toBe(true);
      expect(queryEditorLanguageIdForCapabilities(capabilities)).toBe("sql");
      expect(supportsTableWorkspace(capabilities)).toBe(false);
    }
  });

  it("keeps every DBX reference data model on its declared editor and grid boundary", () => {
    for (const candidate of REFERENCE_DATABASE_DRIVER_CANDIDATES) {
      const capabilities = {
        ...defaultDatabaseCapabilities("postgres"),
        driver: candidate.driver,
        displayName: candidate.displayName,
        dataModel: candidate.dataModel,
        lspLanguageId: candidate.genericLspLanguageId || "vendor-dsl",
        supportsSqlQuery: candidate.dataModel === "relational",
        supportsTableBrowsing: true,
        supportsTableRowMutation: false,
        supportsTableDdl: false,
      };

      if (candidate.dataModel === "relational") {
        expect(queryEditorLanguageIdForCapabilities(capabilities)).toBe("sql");
        expect(supportsLspCapabilities(capabilities)).toBe(true);
        expect(supportsTableWorkspace(capabilities)).toBe(true);
      } else {
        expect(supportsTableWorkspace(capabilities)).toBe(false);
      }
    }
  });

  it("keeps a JDBC package out of connection choices until its managed runtime is ready", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "trino",
        displayName: "Trino",
        clientLibrary: "trino-jdbc",
        clientVersion: "1.0",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package",
        implementation: "isolated JDBC driver sidecar",
        runtime: "Managed Java 21 unavailable",
        runtimeReady: false,
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("postgres"),
          driver: "trino",
          displayName: "Trino",
          lspLanguageId: "sql",
          supportsTableRowMutation: false,
          supportsTableDdl: false,
          supportsTransactions: false,
        },
      },
    ]);

    expect(
      supportedDatabaseDriverProfiles().some((profile) => profile.driver === "trino"),
    ).toBe(false);
  });

  it("uses an external package connection-mode contract instead of hard-coded driver IDs", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "embedded-analytics",
        displayName: "Embedded Analytics",
        clientLibrary: "fixture",
        clientVersion: "1.0",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "local",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("sqlite"),
          driver: "embedded-analytics",
          displayName: "Embedded Analytics",
          connectionMode: "file",
          supportsTableRowMutation: false,
          supportsTableDdl: false,
        },
      },
    ]);

    expect(isFileBasedDatabaseDriver("embedded-analytics")).toBe(true);
    expect(defaultDatabaseCapabilities("embedded-analytics").connectionMode).toBe("file");
  });

  it("keeps an HTTP sidecar selectable while preserving its SQLite LSP identity", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "rqlite",
        displayName: "RQLite",
        clientLibrary: "rqlite-http-api",
        clientVersion: "HTTP API",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "detected-at-connection",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("sqlite"),
          driver: "rqlite",
          displayName: "RQLite",
          connectionMode: "network",
          defaultPort: 4001,
          lspLanguageId: "sqlite",
          supportsConnectionDatabase: false,
          supportsTableRowMutation: false,
          supportsTableDdl: false,
          supportsTransactions: false,
        },
      },
    ]);

    expect(buildConnectionUrl({ driver: "rqlite", host: "cluster.test", database: "ignored" })).toBe(
      "rqlite://cluster.test:4001",
    );
    expect(parseConnectionUrl("https://cluster.test:4001", "rqlite")).toMatchObject({
      driver: "rqlite",
      host: "cluster.test",
      port: 4001,
    });
    expect(lspLanguageId("rqlite")).toBe("sqlite");
  });

  it("keeps future dedicated workspaces out of SQL completion and the mutable table grid", () => {
    const graphCapabilities = {
      dataModel: "graph" as const,
      lspLanguageId: "cypher",
      supportsSqlQuery: false,
      supportsTableBrowsing: true,
    };

    expect(supportsLspCapabilities(graphCapabilities)).toBe(false);
    expect(queryEditorLanguageIdForCapabilities(graphCapabilities)).toBe(
      "plaintext",
    );
    expect(supportsTableWorkspace(graphCapabilities)).toBe(false);

    expect(
      queryEditorLanguageIdForCapabilities({
        ...graphCapabilities,
        dataModel: "timeSeries",
        lspLanguageId: "sql",
      }),
    ).toBe("sql");
  });

  it("uses the dedicated ClickHouse LSP profile and preserves its catalog URL", () => {
    syncExternalDatabaseDriverProfiles([
      {
        driver: "clickhouse",
        displayName: "ClickHouse",
        clientLibrary: "clickhouse-http-api",
        clientVersion: "HTTP API",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "detected-at-connection",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("postgres"),
          driver: "clickhouse",
          displayName: "ClickHouse",
          connectionMode: "network",
          defaultPort: 8123,
          lspLanguageId: "clickhouse",
          namespaceLabel: "database",
          identifierQuote: "`",
          supportsDatabaseCatalogs: true,
          supportsTableRowMutation: false,
          supportsTableDdl: false,
          supportsTransactions: false,
          supportsQueryCancellation: false,
        },
      },
    ]);

    expect(buildConnectionUrl({ driver: "clickhouse", host: "warehouse.test", database: "analytics" })).toBe(
      "clickhouse://warehouse.test:8123/analytics",
    );
    expect(parseConnectionUrl("https://warehouse.test:8443", "clickhouse")).toMatchObject({
      driver: "clickhouse",
      host: "warehouse.test",
      port: 8443,
    });
    expect(lspLanguageId("clickhouse")).toBe("clickhouse");
  });

  it("keeps DuckDB as a selectable LSP identity while using the bundled compatible grammar", () => {
    expect(defaultDatabaseCapabilities("duckdb").connectionMode).toBe("network");

    syncExternalDatabaseDriverProfiles([
      {
        driver: "duckdb",
        displayName: "DuckDB",
        clientLibrary: "duckdb-rs",
        clientVersion: "1.0",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "embedded",
        implementation: "isolated driver sidecar",
        packageVersion: "1.0.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        capabilities: {
          ...defaultDatabaseCapabilities("sqlite"),
          driver: "duckdb",
          displayName: "DuckDB",
          connectionMode: "file",
          lspLanguageId: "duckdb",
          supportsDatabaseCatalogs: true,
          supportsTableRowMutation: false,
          supportsTableDdl: false,
        },
      },
    ]);

    expect(isFileBasedDatabaseDriver("duckdb")).toBe(true);
    expect(supportsLspLanguageId("duckdb")).toBe(true);
    expect(defaultDatabaseCapabilities("duckdb").supportsDatabaseCatalogs).toBe(
      true,
    );
    expect(buildConnectionUrl({ driver: "duckdb", database: ":memory:" })).toBe(
      "duckdb::memory:",
    );
    expect(parseConnectionUrl("duckdb:///tmp/analytics.duckdb")).toMatchObject({
      driver: "duckdb",
      database: "/tmp/analytics.duckdb",
    });
  });
});
