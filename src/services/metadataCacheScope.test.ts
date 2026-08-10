import { describe, expect, it } from "vitest";
import { postgresDatabaseCatalogParentId } from "./postgresDatabaseCatalogCache";
import { tableMetadataParentId } from "./tableMetadataCache";
import {
  isMetadataConnectionScopeCurrent,
  resolveMetadataConnectionScope,
} from "./metadataConnectionScope";
import { useConnectionStore } from "@/store/useConnectionStore";

const tableIdentity = {
  projectId: "project-a",
  connectionId: "connection-a",
  driver: "postgres" as const,
  driverPackageVersion: null,
  connectionDatabaseName: "app",
  schema: "public",
  table: "users",
};

describe("metadata cache scope", () => {
  it("separates table metadata by driver package version", () => {
    expect(tableMetadataParentId(tableIdentity)).not.toBe(
      tableMetadataParentId({
        ...tableIdentity,
        driverPackageVersion: "postgres-sidecar@2.0.0",
      }),
    );
  });

  it("separates a connection database from an explicit catalog", () => {
    expect(tableMetadataParentId(tableIdentity)).not.toBe(
      tableMetadataParentId({
        ...tableIdentity,
        databaseName: "analytics",
      }),
    );
    expect(
      tableMetadataParentId({
        ...tableIdentity,
        databaseName: "analytics",
      }),
    ).not.toBe(
      tableMetadataParentId({
        ...tableIdentity,
        connectionDatabaseName: "analytics",
        databaseName: "app",
      }),
    );
  });

  it("separates database catalogs after an in-place connection edit", () => {
    const identity = {
      projectId: "project-a",
      connectionId: "connection-a",
      driver: "postgres" as const,
      driverPackageVersion: null,
      connectionDatabaseName: "app",
    };
    expect(postgresDatabaseCatalogParentId(identity)).not.toBe(
      postgresDatabaseCatalogParentId({
        ...identity,
        connectionDatabaseName: "warehouse",
      }),
    );
  });

  it("rejects a request whose saved package scope changed in place", () => {
    const previousConnections = useConnectionStore.getState().connections;
    try {
      useConnectionStore.setState({
        connections: [
          {
            id: "connection-a",
            name: "Postgres",
            driver: "postgres",
            driverPackageVersion: "package@1",
            database: "app",
            url: "postgres://localhost/app",
          },
        ],
      });
      const captured = resolveMetadataConnectionScope({
        connectionId: "connection-a",
        driver: "postgres",
      });
      expect(isMetadataConnectionScopeCurrent(captured)).toBe(true);

      useConnectionStore.setState({
        connections: [
          {
            id: "connection-a",
            name: "Postgres",
            driver: "postgres",
            driverPackageVersion: "package@2",
            database: "warehouse",
            url: "postgres://localhost/warehouse",
          },
        ],
      });
      expect(isMetadataConnectionScopeCurrent(captured)).toBe(false);
    } finally {
      useConnectionStore.setState({ connections: previousConnections });
    }
  });
});
