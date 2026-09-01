import { describe, expect, it } from "vitest";
import {
  connectionUrlScheme,
  defaultDatabaseCapabilities,
  defaultDatabasePort,
} from "./databaseDialect";

describe("InfluxDB 3 dialect profile", () => {
  it("uses the HTTP SQL endpoint and exposes a read-only table workspace", () => {
    expect(connectionUrlScheme("influxdb3")).toBe("http");
    expect(defaultDatabasePort("influxdb3")).toBe(8181);
    expect(defaultDatabaseCapabilities("influxdb3")).toMatchObject({
      dataModel: "relational",
      lspLanguageId: "sql",
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      supportsDatabaseCatalogs: true,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsTransactions: false,
    });
  });
});

describe("VictoriaMetrics dialect profile", () => {
  it("uses the native MetricsQL workspace without claiming SQL LSP support", () => {
    expect(connectionUrlScheme("victoriametrics")).toBe("http");
    expect(defaultDatabasePort("victoriametrics")).toBe(8428);
    expect(defaultDatabaseCapabilities("victoriametrics")).toMatchObject({
      dataModel: "timeSeries",
      lspLanguageId: "victoriametrics",
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      supportsConnectionDatabase: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsTransactions: false,
    });
  });
});

describe("InfluxDB 1.x / 2.x dialect profile", () => {
  it("uses the time-series workspace without claiming SQL LSP support", () => {
    expect(connectionUrlScheme("influxdb")).toBe("http");
    expect(defaultDatabasePort("influxdb")).toBe(8086);
    expect(defaultDatabaseCapabilities("influxdb")).toMatchObject({
      dataModel: "timeSeries",
      lspLanguageId: "influxdb",
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      supportsDatabaseCatalogs: true,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsTransactions: false,
    });
  });
});

describe("Meilisearch dialect profile", () => {
  it("exposes a native index browser without inventing a SQL workspace", () => {
    expect(connectionUrlScheme("meilisearch")).toBe("http");
    expect(defaultDatabasePort("meilisearch")).toBe(7700);
    expect(defaultDatabaseCapabilities("meilisearch")).toMatchObject({
      dataModel: "search",
      lspLanguageId: "meilisearch",
      supportsCollectionBrowsing: true,
      supportsSqlQuery: false,
      supportsConnectionDatabase: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsTransactions: false,
    });
  });
});
