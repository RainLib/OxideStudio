import { describe, expect, it } from "vitest";
import {
  DBX_REFERENCE_DRIVER_IDS,
  DBX_REFERENCE_BASELINE,
  DBX_REFERENCE_EXTENSION_IDS,
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  driverCandidateAvailability,
  referenceDriverPackageRequirement,
  referenceDriverCandidate,
  referenceDriverDeliveryPlan,
} from "./referenceDriverCatalog";
import baseline from "./__fixtures__/dbx-catalog-2026-10-21.json";

describe("DBX reference driver catalogue", () => {
  it("tracks the exact pinned upstream roster, with extension entries separate", () => {
    expect(DBX_REFERENCE_BASELINE.revision).toBe(baseline.revision);
    const catalogIds = [...DBX_REFERENCE_DRIVER_IDS, ...DBX_REFERENCE_EXTENSION_IDS];
    expect([...catalogIds].sort()).toEqual([...baseline.databaseTypes].sort());
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
    expect(referenceDriverCandidate("plugin")).toBeUndefined();
  });

  it("keeps the five explicit compatibility products separate from the DBX baseline", () => {
    expect(REFERENCE_DATABASE_DRIVER_CANDIDATES).toHaveLength(93);
    const compatibilityCandidates = REFERENCE_DATABASE_DRIVER_CANDIDATES.filter(
      (candidate) => candidate.source === "compatibility",
    );
    expect(compatibilityCandidates.map((candidate) => candidate.driver)).toEqual([
      "cockroachdb",
      "yugabytedb",
      "timescaledb",
      "tidb",
      "greenplum",
    ]);
    expect(referenceDriverCandidate("rocketmq")).toMatchObject({
      source: "dbx-agent",
      dataModel: "queue",
      preferredRuntime: "native",
    });
  });

  it("keeps new products gated and assigns their own query and runtime families", () => {
    for (const driver of ["solr", "couchdb", "gbase8s", "gbase8c", "transwarp", "nebula", "salesforce"]) {
      expect(driverCandidateAvailability(referenceDriverCandidate(driver)!, [])).toBe("requiresPackage");
    }
    for (const driver of ["gbase8s", "gbase8c", "transwarp"]) {
      expect(referenceDriverDeliveryPlan(referenceDriverCandidate(driver)!)).toMatchObject({
        runtimeRoute: "signedJdbc",
        lspRoute: "genericSql",
      });
    }
    for (const driver of ["solr", "couchdb", "nebula"]) {
      expect(referenceDriverDeliveryPlan(referenceDriverCandidate(driver)!)).toMatchObject({
        runtimeRoute: "dedicatedWorkspace",
        lspRoute: "notApplicable",
        lspLanguageId: null,
      });
    }
    expect(referenceDriverCandidate("nebula")?.dataModel).toBe("graph");
    expect(referenceDriverCandidate("couchdb")?.dataModel).toBe("document");
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("salesforce")!)).toMatchObject({
      runtimeRoute: "signedSidecar",
      lspRoute: "notApplicable",
      lspLanguageId: null,
    });
  });

  it("keeps the latest DBX products unavailable until their own package is ready", () => {
    const nativeWorkspaceProducts = [
      "dynamodb",
      "iotdb",
      "mqtt",
    ];
    const jdbcProducts = ["kyuubi", "impala", "spanner", "ignite", "ignite3"];

    for (const driver of [...nativeWorkspaceProducts, ...jdbcProducts]) {
      const candidate = referenceDriverCandidate(driver);
      expect(candidate).toBeDefined();
      expect(driverCandidateAvailability(candidate!, [])).toBe("requiresPackage");
    }

    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("kyuubi")!)).toMatchObject({
      runtimeRoute: "signedJdbc",
      lspRoute: "compatibleSql",
      lspParserBaseline: "hive",
    });
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("impala")!)).toMatchObject({
      runtimeRoute: "signedJdbc",
      lspRoute: "compatibleSql",
      lspParserBaseline: "hive",
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
    expect(referenceDriverPackageRequirement(referenceDriverCandidate("kingbase")!)).toBe(
      "Signed native Agent package required",
    );
    expect(referenceDriverPackageRequirement(referenceDriverCandidate("iotdb")!)).toBe(
      "Dedicated workspace runtime required",
    );
    expect(referenceDriverDeliveryPlan(referenceDriverCandidate("victoriametrics")!)).toMatchObject({
      runtimeRoute: "bundled",
      lspRoute: "notApplicable",
    });
    const consul = referenceDriverCandidate("consul");
    expect(consul?.dataModel).toBe("keyValue");
    expect(driverCandidateAvailability(consul!, [])).toBe("bundled");
    expect(referenceDriverDeliveryPlan(consul!)).toMatchObject({
      runtimeRoute: "bundled",
      lspRoute: "notApplicable",
    });
    const meilisearch = referenceDriverCandidate("meilisearch");
    expect(driverCandidateAvailability(meilisearch!, [])).toBe("bundled");
    expect(referenceDriverDeliveryPlan(meilisearch!)).toMatchObject({
      runtimeRoute: "bundled",
      lspRoute: "notApplicable",
    });
  });

  it("routes InfluxDB 3 through the bundled SQL runtime", () => {
    const candidate = referenceDriverCandidate("influxdb3");
    expect(candidate).toBeDefined();
    expect(driverCandidateAvailability(candidate!, [])).toBe("bundled");
    expect(referenceDriverDeliveryPlan(candidate!)).toMatchObject({
      runtimeRoute: "bundled",
      lspRoute: "genericSql",
      lspLanguageId: "sql",
      lspParserBaseline: "postgres",
    });
  });

  it("routes InfluxDB 1.x / 2.x through the bundled native workspace", () => {
    const candidate = referenceDriverCandidate("influxdb");
    expect(candidate).toBeDefined();
    expect(driverCandidateAvailability(candidate!, [])).toBe("bundled");
    expect(referenceDriverDeliveryPlan(candidate!)).toMatchObject({
      runtimeRoute: "bundled",
      lspRoute: "notApplicable",
      lspLanguageId: null,
    });
  });

  it("uses bundled wire-compatible runtimes for DBX profile products", () => {
    for (const driver of [
      "cockroachdb",
      "gaussdb",
      "greenplum",
      "opengauss",
      "redshift",
      "tidb",
      "timescaledb",
      "yugabytedb",
    ]) {
      const candidate = referenceDriverCandidate(driver);
      expect(candidate).toBeDefined();
      expect(driverCandidateAvailability(candidate!, [])).toBe("bundled");
      expect(referenceDriverDeliveryPlan(candidate!)).toMatchObject({
        runtimeRoute: "bundled",
        lspRoute: "compatibleSql",
      });
    }

    const easysearch = referenceDriverCandidate("easysearch");
    expect(easysearch).toBeDefined();
    expect(driverCandidateAvailability(easysearch!, [])).toBe("bundled");
    expect(referenceDriverDeliveryPlan(easysearch!)).toMatchObject({
      runtimeRoute: "bundled",
      lspRoute: "nativeProvider",
    });
  });
});
