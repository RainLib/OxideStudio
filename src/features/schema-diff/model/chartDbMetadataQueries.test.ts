import { describe, expect, it } from "vitest";
import { chartDbMetadataQueryForDriver } from "./chartDbMetadataQueries";

describe("chartDbMetadataQueryForDriver", () => {
  it.each([
    ["postgres", "public", "jsonb_build_object"],
    ["cockroachdb", "public", "jsonb_build_object"],
    ["mysql", "app", "JSON_OBJECT"],
    ["mariadb", "app", "JSON_OBJECT"],
    ["sqlite", "main", "json_object"],
    ["sqlserver", "dbo", "FOR JSON PATH"],
    ["clickhouse", "analytics", "toJSONString"],
    ["oracle", "APP", "JSON_ARRAYAGG"],
  ])("builds a %s query with the ChartDB result contract", (driver, schema, marker) => {
    const result = chartDbMetadataQueryForDriver(driver, schema, schema);
    expect(result?.query).toContain(marker);
    expect(result?.query).toContain("metadata_json_to_import");
    expect(result?.query.toLowerCase()).toContain("tables");
    expect(result?.query.toLowerCase()).toContain("columns");
    expect(result?.query.toLowerCase()).toContain("pk_info");
    expect(result?.query.toLowerCase()).toContain("fk_info");
    expect(result?.query.toLowerCase()).toContain("indexes");
  });

  it("escapes target schema literals instead of interpolating executable SQL", () => {
    const result = chartDbMetadataQueryForDriver(
      "postgres",
      "team'schema",
      null,
    );
    expect(result?.query).toContain("'team''schema'");
    expect(result?.query).not.toContain("n.nspname = 'team'schema'");
  });

  it("does not offer a relational catalog query for unsupported data models", () => {
    expect(chartDbMetadataQueryForDriver("mongodb", "app", null)).toBeNull();
  });
});
