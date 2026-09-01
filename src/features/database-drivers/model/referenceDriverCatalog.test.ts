import { describe, expect, it } from "vitest";
import {
  DBX_REFERENCE_DRIVER_IDS,
  driverCandidateAvailability,
  referenceDriverCandidate,
  referenceDriverDeliveryPlan,
} from "./referenceDriverCatalog";

describe("DBX reference driver catalogue", () => {
  it("tracks the complete 70-product DBX baseline without duplicate ids", () => {
    expect(DBX_REFERENCE_DRIVER_IDS).toHaveLength(70);
    expect(new Set(DBX_REFERENCE_DRIVER_IDS).size).toBe(70);
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
});
