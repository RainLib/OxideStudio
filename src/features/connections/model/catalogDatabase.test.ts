import { describe, expect, it } from "vitest";
import { connectionCatalogDatabaseName, managedCatalogDatabaseName } from "./catalogDatabase";
import type { ManagedDataSourceDescriptor } from "@/services/tauri/enterprise.service";

const descriptor = (paths: string[]): ManagedDataSourceDescriptor => ({
  organizationId: "org", projectId: "project", dataSourceId: "source", gatewayId: "gateway",
  driver: "postgres", displayName: "Fixture", capabilities: [],
  allowedResourceSummary: paths, policyRevision: "1",
});

describe("managed catalog identity", () => {
  it("uses the database segment rather than a full authorization path", () => {
    expect(managedCatalogDatabaseName(descriptor(["oxide_studio_validation/validation"])))
      .toBe("oxide_studio_validation");
  });
  it("coalesces table and schema grants within one database", () => {
    expect(managedCatalogDatabaseName(descriptor(["app/public/orders", "app/audit", "app/public/users"])))
      .toBe("app");
  });
  it.each([[], ["app/public", "other/public"], ["*/public"], [""]].map(paths => ({ paths })))(
    "does not invent a default database for unknown or ambiguous grants: $paths", ({ paths }) => {
      expect(managedCatalogDatabaseName(descriptor(paths))).toBe("");
    },
  );
  it("repairs legacy managed connection paths without rewriting local connection precedence", () => {
    expect(connectionCatalogDatabaseName({ origin: "managed", driver: "postgres", database: "app/public",
      managedDescriptor: descriptor(["app/public"]) })).toBe("app");
    expect(connectionCatalogDatabaseName({ origin: "managed", driver: "postgres" })).toBe("");
    expect(connectionCatalogDatabaseName({ driver: "postgres", database: "fields",
      connectionUrl: "postgres://localhost/url_database" })).toBe("url_database");
  });
});
