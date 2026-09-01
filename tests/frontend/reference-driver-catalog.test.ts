import { describe, expect, it } from "vitest";
import {
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  DBX_REFERENCE_DRIVER_IDS,
  DBX_DIALECT_REFERENCE_DRIVER_IDS,
  SQL_LSP_COMPATIBILITY_BASELINE_BY_DRIVER,
  driverCandidateAvailability,
  driverCandidateConformance,
  referenceDriverDeliveryPlan,
  referenceDriverCandidate,
} from "@/features/database-drivers";

describe("reference database driver catalogue", () => {
  it("keeps the complete DBX reference roster plus explicitly labelled compatibility targets", () => {
    const ids = REFERENCE_DATABASE_DRIVER_CANDIDATES.map(
      (candidate) => candidate.driver,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(REFERENCE_DATABASE_DRIVER_CANDIDATES).toHaveLength(85);
    expect(DBX_REFERENCE_DRIVER_IDS).toEqual([
      "mysql", "postgres", "sqlite", "rqlite", "redis", "duckdb",
      "clickhouse", "sqlserver", "mongodb", "dynamodb", "oracle", "elasticsearch",
      "easysearch", "meilisearch", "hbase", "qdrant", "milvus", "weaviate", "chromadb",
      "doris", "starrocks", "manticoresearch", "databend", "redshift",
      "dameng", "kingbase", "highgo", "uxdb", "vastbase", "goldendb",
      "gaussdb", "kwdb", "yashandb", "databricks", "saphana", "teradata",
      "vertica", "firebird", "exasol", "opengauss", "oceanbase-oracle",
      "gbase", "access", "h2", "snowflake", "trino", "prestosql", "hive",
      "kyuubi", "argo", "impala", "spark", "db2", "informix", "neo4j", "cassandra", "bigquery", "spanner", "kylin",
      "ignite", "ignite3", "sundb", "oscar", "tdengine", "xugu", "iotdb", "etcd", "zookeeper",
      "nacos", "consul", "mqtt", "iris", "turso", "cloudflare-d1", "influxdb", "influxdb3", "victoriametrics", "questdb", "jdbc",
      "mq",
    ]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "mysql",
        "postgres",
        "rqlite",
        "clickhouse",
        "oracle",
        "mongodb",
        "elasticsearch",
        "neo4j",
        "influxdb",
        "influxdb3",
        "cloudflare-d1",
        "mq",
      ]),
    );
    expect(referenceDriverCandidate("tidb")).toMatchObject({
      source: "compatibility",
      dataModel: "relational",
    });
    expect(referenceDriverCandidate("manticoresearch")).toMatchObject({
      dataModel: "search",
      genericLspLanguageId: "sql",
    });
    expect(referenceDriverCandidate("questdb")).toMatchObject({
      dataModel: "timeSeries",
      genericLspLanguageId: "sql",
    });
  });

  it("retains every DBX declarative dialect under its normalized driver id", () => {
    const candidates = new Map(
      REFERENCE_DATABASE_DRIVER_CANDIDATES.map((candidate) => [
        candidate.driver,
        candidate,
      ]),
    );

    expect(DBX_DIALECT_REFERENCE_DRIVER_IDS).toHaveLength(35);
    for (const driver of DBX_DIALECT_REFERENCE_DRIVER_IDS) {
      expect(candidates.get(driver)?.source).toBe("dbx-reference");
    }
    expect(DBX_DIALECT_REFERENCE_DRIVER_IDS).toEqual(
      expect.arrayContaining(["postgres", "oceanbase-oracle", "questdb"]),
    );
  });

  it("gives every tracked product an explicit runtime and intelligence route without activating it", () => {
    for (const candidate of REFERENCE_DATABASE_DRIVER_CANDIDATES) {
      const plan = referenceDriverDeliveryPlan(candidate);
      expect(["bundled", "signedSidecar", "signedJdbc", "dedicatedWorkspace"])
        .toContain(plan.runtimeRoute);

      if (candidate.dataModel === "relational" || candidate.genericLspLanguageId === "sql") {
        expect(["dedicated", "compatibleSql", "genericSql"]).toContain(plan.lspRoute);
        expect(plan.lspLanguageId).toBeTruthy();
      } else if (candidate.genericLspLanguageId) {
        expect(plan.lspRoute).toBe("nativeProvider");
        expect(plan.lspLanguageId).toBe(candidate.genericLspLanguageId);
      } else {
        expect(plan.lspRoute).toBe("notApplicable");
        expect(plan.runtimeRoute).toBe(
          candidate.preferredRuntime === "bundled"
            ? "bundled"
            : "dedicatedWorkspace",
        );
      }
    }

    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("clickhouse")!)).toMatchObject({
      runtimeRoute: "signedSidecar",
      lspRoute: "dedicated",
      lspLanguageId: "clickhouse",
      lspServerDialect: "clickhouse",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("oracle")!)).toMatchObject({
      runtimeRoute: "signedJdbc",
      lspRoute: "compatibleSql",
      lspLanguageId: "sql",
      lspServerDialect: "oracle",
      lspParserBaseline: "postgres",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("doris")!)).toMatchObject({
      runtimeRoute: "signedJdbc",
      lspRoute: "compatibleSql",
      lspLanguageId: "sql",
      lspServerDialect: "doris",
      lspParserBaseline: "mysql",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("db2")!)).toMatchObject({
      runtimeRoute: "signedJdbc",
      lspRoute: "compatibleSql",
      lspLanguageId: "sql",
      lspServerDialect: "db2",
      lspParserBaseline: "postgres",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("argo")!)).toMatchObject({
      runtimeRoute: "signedJdbc",
      lspRoute: "compatibleSql",
      lspLanguageId: "sql",
      lspServerDialect: "argo",
      lspParserBaseline: "hive",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("neo4j")!)).toMatchObject({
      runtimeRoute: "dedicatedWorkspace",
      lspRoute: "notApplicable",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("kingbase")!)).toMatchObject({
      runtimeRoute: "signedSidecar",
      lspRoute: "compatibleSql",
      lspParserBaseline: "postgres",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("iotdb")!)).toMatchObject({
      runtimeRoute: "dedicatedWorkspace",
      lspRoute: "notApplicable",
    });
  });

  it("keeps DBX dialect identities distinct from their compatibility parser baselines", () => {
    const dedicated = new Set(["clickhouse", "duckdb", "mysql", "postgres", "rqlite", "sqlite"]);

    for (const driver of DBX_DIALECT_REFERENCE_DRIVER_IDS) {
      if (dedicated.has(driver)) continue;
      const baseline = SQL_LSP_COMPATIBILITY_BASELINE_BY_DRIVER[driver];
      expect(baseline, `${driver} needs an explicit reviewed baseline`).toBeTruthy();
      expect(referenceDriverDeliveryPlan(referenceDriverCandidate(driver)!)).toMatchObject({
        lspRoute: "compatibleSql",
        lspLanguageId: "sql",
        lspServerDialect: driver,
        lspParserBaseline: baseline,
      });
    }
  });

  it("does not turn an uninstalled reference row into a connection-capable driver", () => {
    const oracle = referenceDriverCandidate("oracle");
    const mongodb = referenceDriverCandidate("mongodb");
    if (!oracle || !mongodb) throw new Error("Reference catalog fixture is incomplete");

    expect(driverCandidateAvailability(oracle, [])).toBe("requiresPackage");
    expect(driverCandidateAvailability(mongodb, [])).toBe("bundled");
    expect(
      driverCandidateAvailability(oracle, [
        {
          driver: "oracle",
          displayName: "Oracle Database",
          clientLibrary: "ojdbc",
          clientVersion: "23",
          distribution: "external",
          updatePolicy: "independent",
          independentlyUpdatable: true,
          serverVersionPolicy: "declared-by-package",
          implementation: "isolated JDBC driver sidecar",
          packageVersion: "1.0.0",
          protocolVersion: "1.0",
          active: true,
          status: "ready",
          runtimeReady: false,
        },
      ]),
    ).toBe("requiresPackage");
  });

  it("recognizes a ready, active signed package without granting unrelated capabilities", () => {
    const oracle = referenceDriverCandidate("oracle");
    if (!oracle) throw new Error("Reference catalog fixture is incomplete");

    expect(
      driverCandidateAvailability(oracle, [
        {
          driver: "oracle",
          displayName: "Oracle Database",
          clientLibrary: "ojdbc",
          clientVersion: "23",
          distribution: "external",
          updatePolicy: "independent",
          independentlyUpdatable: true,
          serverVersionPolicy: "declared-by-package",
          implementation: "isolated JDBC driver sidecar",
          packageVersion: "1.0.0",
          protocolVersion: "1.0",
          active: true,
          status: "ready",
          runtimeReady: true,
        },
      ]),
    ).toBe("activePackage");
  });

  it("reports server-version evidence only for the matching active signed release", () => {
    const oracle = referenceDriverCandidate("oracle");
    if (!oracle) throw new Error("Reference catalog fixture is incomplete");
    const installations = [
      {
        driver: "oracle",
        displayName: "Oracle Database",
        clientLibrary: "ojdbc",
        clientVersion: "23",
        distribution: "external" as const,
        updatePolicy: "independent" as const,
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package" as const,
        implementation: "isolated JDBC driver sidecar",
        packageVersion: "1.2.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready" as const,
        runtimeReady: true,
      },
    ];

    expect(driverCandidateConformance(oracle, installations, [])).toEqual({
      state: "activeUnrecorded",
      verifiedVersions: [],
    });
    expect(
      driverCandidateConformance(oracle, installations, [
        {
          driverId: "oracle",
          displayName: "Oracle Database",
          packageVersion: "1.1.0",
          protocolVersion: "1.0",
          downloadUrl: "https://example.test/oracle-1.1.0.zip",
          supportedTargets: ["aarch64-apple-darwin"],
          conformance: { connect: ["19c"], metadata: [], query: [], cancellation: [], mutations: [], migration: [] },
        },
      ]),
    ).toEqual({ state: "activeUnrecorded", verifiedVersions: [] });
    expect(
      driverCandidateConformance(oracle, installations, [
        {
          driverId: "oracle",
          displayName: "Oracle Database",
          packageVersion: "1.2.0",
          protocolVersion: "1.0",
          downloadUrl: "https://example.test/oracle-1.2.0.zip",
          supportedTargets: ["aarch64-apple-darwin"],
          conformance: {
            connect: ["19c"],
            metadata: ["19c"],
            query: ["19c"],
            cancellation: [],
            mutations: [],
            migration: [],
          },
        },
      ]),
    ).toEqual({ state: "activeUnrecorded", verifiedVersions: [] });
    expect(
      driverCandidateConformance(oracle, installations, [
        {
          driverId: "oracle",
          displayName: "Oracle Database",
          packageVersion: "1.2.0",
          protocolVersion: "1.0",
          downloadUrl: "https://example.test/oracle-1.2.0.zip",
          supportedTargets: ["aarch64-apple-darwin"],
          conformance: {
            connect: ["19c"],
            metadata: ["19c", "23ai"],
            query: ["23ai"],
            cancellation: [],
            mutations: [],
            migration: [],
            dataTransfer: ["19c"],
            evidence: [
              {
                schemaVersion: 1,
                runnerVersion: "1.0.0",
                driverId: "oracle",
                packageVersion: "1.2.0",
                entrypointSha256: "a".repeat(64),
                target: "aarch64-apple-darwin",
                serverVersion: "19c",
                fixtureId: "oracle-core-v1",
                fixtureSha256: "b".repeat(64),
                reportUrl: "https://example.test/evidence/oracle-19c.json",
                reportSha256: "c".repeat(64),
                operations: ["connect", "metadata", "dataTransfer"],
              },
              {
                schemaVersion: 1,
                runnerVersion: "1.0.0",
                driverId: "oracle",
                packageVersion: "1.2.0",
                entrypointSha256: "a".repeat(64),
                target: "aarch64-apple-darwin",
                serverVersion: "23ai",
                fixtureId: "oracle-query-v1",
                fixtureSha256: "d".repeat(64),
                reportUrl: "https://example.test/evidence/oracle-23ai.json",
                reportSha256: "e".repeat(64),
                operations: ["connect", "metadata", "query"],
              },
            ],
          },
        },
      ]),
    ).toEqual({ state: "activeRecorded", verifiedVersions: ["19c", "23ai"] });
  });
});
