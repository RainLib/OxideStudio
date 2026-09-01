import { describe, expect, it } from "vitest";
import {
  connectionUrlScheme,
  defaultDatabaseCapabilities,
  defaultDatabasePort,
  normalizeDatabaseDriverName,
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

describe("Consul dialect profile", () => {
  it("exposes only the native read-only KV browse surface", () => {
    expect(connectionUrlScheme("consul")).toBe("http");
    expect(defaultDatabasePort("consul")).toBe(8500);
    expect(defaultDatabaseCapabilities("consul")).toMatchObject({
      dataModel: "keyValue",
      lspLanguageId: "consul",
      supportsSqlQuery: false,
      supportsKeyValueBrowsing: true,
      supportsConnectionDatabase: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsTransactions: false,
    });
  });
});

describe("etcd dialect profile", () => {
  it("exposes only the native read-only KV browse surface", () => {
    expect(connectionUrlScheme("etcd")).toBe("http");
    expect(defaultDatabasePort("etcd")).toBe(2379);
    expect(defaultDatabaseCapabilities("etcd")).toMatchObject({
      dataModel: "keyValue",
      lspLanguageId: "etcd",
      supportsSqlQuery: false,
      supportsKeyValueBrowsing: true,
      supportsConnectionDatabase: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsTransactions: false,
    });
  });
});

describe("Nacos dialect profile", () => {
  it("exposes only the native read-only configuration browse surface", () => {
    expect(connectionUrlScheme("nacos")).toBe("http");
    expect(defaultDatabasePort("nacos")).toBe(8848);
    expect(defaultDatabaseCapabilities("nacos")).toMatchObject({
      dataModel: "keyValue",
      lspLanguageId: "nacos",
      supportsSqlQuery: false,
      supportsKeyValueBrowsing: true,
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

describe("DBX protocol-compatible connection profiles", () => {
  it("reuses bundled transport defaults without losing the selected product", () => {
    expect(defaultDatabasePort("tidb")).toBe(3306);
    expect(connectionUrlScheme("tidb")).toBe("mysql");
    expect(defaultDatabaseCapabilities("tidb")).toMatchObject({
      driver: "tidb",
      lspLanguageId: "mysql",
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
    });

    for (const driver of [
      "cockroachdb",
      "greenplum",
      "timescaledb",
      "yugabytedb",
    ]) {
      expect(defaultDatabasePort(driver)).toBe(5432);
      expect(connectionUrlScheme(driver)).toBe("postgres");
      expect(defaultDatabaseCapabilities(driver)).toMatchObject({
        driver,
        lspLanguageId: "postgres",
        supportsSqlQuery: true,
      });
    }

    expect(normalizeDatabaseDriverName("tidb")).toBe("mysql");
    expect(normalizeDatabaseDriverName("cockroachdb")).toBe("postgres");
    expect(defaultDatabasePort("easysearch")).toBe(9200);
    expect(connectionUrlScheme("easysearch")).toBe("http");
    expect(defaultDatabaseCapabilities("easysearch")).toMatchObject({
      driver: "easysearch",
      dataModel: "search",
      lspLanguageId: "elasticsearch-dsl",
      supportsCollectionBrowsing: true,
    });
    expect(normalizeDatabaseDriverName("easysearch")).toBe("elasticsearch");
  });
});
