import { describe, expect, it } from "vitest";
import {
  DBX_REFERENCE_DRIVER_IDS,
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  driverCandidateAvailability,
  referenceDriverCandidate,
  referenceDriverDeliveryPlan,
} from "./referenceDriverCatalog";

describe("DBX reference driver catalogue", () => {
  it("tracks the complete 80-product DBX baseline without duplicate ids", () => {
    expect(DBX_REFERENCE_DRIVER_IDS).toHaveLength(80);
    expect(new Set(DBX_REFERENCE_DRIVER_IDS).size).toBe(80);
  });

  it("keeps the five explicit compatibility products separate from the DBX baseline", () => {
    expect(REFERENCE_DATABASE_DRIVER_CANDIDATES).toHaveLength(85);
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
  });

  it("keeps the latest DBX products unavailable until their own package is ready", () => {
    const nativeWorkspaceProducts = [
      "dynamodb",
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
