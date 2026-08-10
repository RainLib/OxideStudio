import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  POSTGRES_DATABASE_CATALOG_CACHE_KIND,
  clearPostgresDatabaseCatalog,
  persistPostgresDatabaseCatalog,
  postgresDatabaseCatalogParentId,
  postgresDatabaseCatalogResourceId,
  readCachedPostgresDatabaseCatalog,
  refreshPostgresDatabaseCatalog,
  subscribePostgresDatabaseCatalog,
  type PostgresDatabaseCatalogIdentity,
} from "@/services/postgresDatabaseCatalogCache";

const mocks = vi.hoisted(() => ({
  getDatabases: vi.fn(),
  getResources: vi.fn(),
  saveResources: vi.fn(),
  deleteResources: vi.fn(),
}));

vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: {
    getDatabases: mocks.getDatabases,
  },
}));

vi.mock("@/services/tauri/store.service", () => ({
  storeService: {
    getResources: mocks.getResources,
    saveResources: mocks.saveResources,
    deleteResources: mocks.deleteResources,
  },
}));

const identity: PostgresDatabaseCatalogIdentity = {
  projectId: "project-a",
  connectionId: "postgres-1",
  driver: "postgres",
  driverPackageVersion: null,
  connectionDatabaseName: null,
};

function cachedResource(
  resourceIdentity = identity,
  databases: string[] = ["app", "analytics"]
) {
  return {
    id: postgresDatabaseCatalogResourceId(resourceIdentity),
    project_id: resourceIdentity.projectId,
    connection_id: resourceIdentity.connectionId,
    parent_id: postgresDatabaseCatalogParentId(resourceIdentity),
    kind: POSTGRES_DATABASE_CATALOG_CACHE_KIND,
    name: "PostgreSQL server database catalog",
    metadata: {
      version: 2,
      driver: resourceIdentity.driver,
      driverPackageVersion: resourceIdentity.driverPackageVersion ?? null,
      connectionDatabaseName: resourceIdentity.connectionDatabaseName ?? null,
      connectionId: resourceIdentity.connectionId,
      databases,
    },
    last_updated: 1234,
  };
}

describe("PostgreSQL database catalog cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getResources.mockResolvedValue([]);
    mocks.saveResources.mockResolvedValue(undefined);
    mocks.deleteResources.mockResolvedValue(undefined);
    mocks.getDatabases.mockResolvedValue(["app", "analytics"]);
  });

  it("reads an isolated catalog snapshot from the explicit project", async () => {
    mocks.getResources.mockResolvedValue([cachedResource()]);

    await expect(readCachedPostgresDatabaseCatalog(identity)).resolves.toEqual({
      databases: ["app", "analytics"],
      source: "cache",
      updatedAt: 1234,
    });
    expect(mocks.getResources).toHaveBeenCalledWith(
      "postgres-1",
      postgresDatabaseCatalogParentId(identity),
      "project-a"
    );
  });

  it("keeps an external catalog provider isolated from PostgreSQL cache entries", async () => {
    const duckdbIdentity: PostgresDatabaseCatalogIdentity = {
      projectId: "project-a",
      connectionId: "duckdb-1",
      driver: "duckdb",
      driverPackageVersion: null,
      connectionDatabaseName: null,
    };
    mocks.getResources.mockResolvedValue([
      cachedResource(duckdbIdentity, ["memory", "analytics"]),
    ]);

    await expect(readCachedPostgresDatabaseCatalog(duckdbIdentity)).resolves.toEqual({
      databases: ["memory", "analytics"],
      source: "cache",
      updatedAt: 1234,
    });
    expect(mocks.getResources).toHaveBeenCalledWith(
      "duckdb-1",
      postgresDatabaseCatalogParentId(duckdbIdentity),
      "project-a",
    );
  });

  it("rejects a resource returned from another project", async () => {
    mocks.getResources.mockResolvedValue([
      cachedResource({ ...identity, projectId: "project-b" }),
    ]);

    await expect(readCachedPostgresDatabaseCatalog(identity)).resolves.toBeNull();
  });

  it("does not reuse a legacy catalog without an explicit project scope", async () => {
    const legacyResource = cachedResource();
    delete (legacyResource as { project_id?: string }).project_id;
    mocks.getResources.mockResolvedValue([legacyResource]);

    await expect(readCachedPostgresDatabaseCatalog(identity)).resolves.toBeNull();
  });

  it("stores a distinct catalog kind without creating DATABASE resources", async () => {
    await persistPostgresDatabaseCatalog(identity, [
      "app",
      " analytics ",
      "app",
    ]);

    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: postgresDatabaseCatalogResourceId(identity),
          project_id: "project-a",
          connection_id: "postgres-1",
          parent_id: postgresDatabaseCatalogParentId(identity),
          kind: POSTGRES_DATABASE_CATALOG_CACHE_KIND,
          metadata: expect.objectContaining({
            driver: "postgres",
            connectionId: "postgres-1",
            databases: ["app", "analytics"],
          }),
        }),
      ],
      "project-a"
    );
  });

  it("captures the request project when a remote refresh completes", async () => {
    let resolveDatabases: ((databases: string[]) => void) | undefined;
    mocks.getDatabases.mockReturnValue(
      new Promise<string[]>((resolve) => {
        resolveDatabases = resolve;
      })
    );

    const refresh = refreshPostgresDatabaseCatalog(identity);
    resolveDatabases?.(["app", "warehouse"]);
    await expect(refresh).resolves.toEqual(
      expect.objectContaining({
        databases: ["app", "warehouse"],
        source: "remote",
      })
    );

    expect(mocks.saveResources).toHaveBeenCalledWith(
      [expect.objectContaining({ project_id: "project-a" })],
      "project-a"
    );
  });

  it("coalesces concurrent refreshes in the same project and connection", async () => {
    const [first, second] = await Promise.all([
      refreshPostgresDatabaseCatalog(identity),
      refreshPostgresDatabaseCatalog(identity),
    ]);

    expect(first.databases).toEqual(["app", "analytics"]);
    expect(second.databases).toEqual(["app", "analytics"]);
    expect(mocks.getDatabases).toHaveBeenCalledOnce();
    expect(mocks.saveResources).toHaveBeenCalledOnce();
  });

  it("publishes refreshed catalogs to every editor and explorer subscriber", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePostgresDatabaseCatalog(identity, listener);

    await refreshPostgresDatabaseCatalog(identity);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        databases: ["app", "analytics"],
        source: "remote",
      })
    );
    unsubscribe();
    listener.mockClear();

    await refreshPostgresDatabaseCatalog(identity);
    expect(listener).not.toHaveBeenCalled();
  });

  it("allows a retry after remote discovery fails", async () => {
    mocks.getDatabases
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce(["app"]);

    await expect(refreshPostgresDatabaseCatalog(identity)).rejects.toThrow(
      "connection closed"
    );
    await expect(refreshPostgresDatabaseCatalog(identity)).resolves.toEqual(
      expect.objectContaining({ databases: ["app"] })
    );
    expect(mocks.getDatabases).toHaveBeenCalledTimes(2);
  });

  it("clears only the catalog kind in the explicit project", async () => {
    await clearPostgresDatabaseCatalog(identity);

    expect(mocks.deleteResources).toHaveBeenCalledWith(
      "postgres-1",
      postgresDatabaseCatalogParentId(identity),
      POSTGRES_DATABASE_CATALOG_CACHE_KIND,
      "project-a"
    );
  });
});
