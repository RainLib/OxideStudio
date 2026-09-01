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
