import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTableDdl: vi.fn(),
  getViewDefinition: vi.fn(),
  getResources: vi.fn(),
  saveResources: vi.fn(),
  deleteResources: vi.fn(),
  resources: new Map<string, any>(),
}));

vi.mock("@/services/tauri", () => ({
  schemaService: {},
  tableService: {
    getTableDdl: mocks.getTableDdl,
    getViewDefinition: mocks.getViewDefinition,
  },
  storeService: {
    getResources: mocks.getResources,
    saveResources: mocks.saveResources,
    deleteResources: mocks.deleteResources,
  },
}));

import {
  invalidateTableMetadata,
  loadTableDdl,
  loadViewDefinition,
  tableMetadataParentId,
  type TableMetadataIdentity,
} from "./tableMetadataCache";

function identity(table: string): TableMetadataIdentity {
  return {
    projectId: "project",
    connectionId: "connection",
    driver: "postgres",
    driverPackageVersion: "bundled@1",
    connectionDatabaseName: "app",
    schema: "public",
    table,
  };
}

function storedDdl(
  target: TableMetadataIdentity,
  ddl: string,
  updatedAt = Date.now(),
  ddlCachedAt = updatedAt,
) {
  return {
    id: `${tableMetadataParentId(target)}:TABLE_METADATA_CACHE`,
    project_id: target.projectId,
    connection_id: target.connectionId,
    parent_id: tableMetadataParentId(target),
    kind: "TABLE_METADATA_CACHE",
    name: target.table,
    metadata: {
      version: 3,
      projectId: target.projectId,
      driver: target.driver,
      driverPackageVersion: target.driverPackageVersion,
      connectionDatabaseName: target.connectionDatabaseName,
      schema: target.schema,
      table: target.table,
      ddl,
      ddlObjectType: "TABLE",
      ddlCachedAt,
    },
    last_updated: updatedAt,
  };
}

describe("table object source cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resources.clear();
    mocks.getResources.mockImplementation(
      async (_connectionId: string, parentId: string) =>
        [...mocks.resources.values()].filter(
          (resource) => resource.parent_id === parentId,
        ),
    );
    mocks.saveResources.mockImplementation(async (resources: any[]) => {
      for (const resource of resources) {
        mocks.resources.set(resource.id, resource);
      }
    });
    mocks.deleteResources.mockImplementation(
      async (_connectionId: string, parentId: string) => {
        for (const [id, resource] of mocks.resources) {
          if (resource.parent_id === parentId) mocks.resources.delete(id);
        }
      },
    );
  });

  it("deduplicates concurrent DDL loads and persists one result", async () => {
    const target = identity("concurrent_users");
    let resolve!: (ddl: string) => void;
    mocks.getTableDdl.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );

    const first = loadTableDdl(target, "TABLE");
    const second = loadTableDdl(target, "TABLE");
    expect(mocks.getTableDdl).toHaveBeenCalledTimes(0);
    await vi.waitFor(() => expect(mocks.getTableDdl).toHaveBeenCalledTimes(1));
    resolve("CREATE TABLE concurrent_users (id bigint)");

    await expect(Promise.all([first, second])).resolves.toEqual([
      "CREATE TABLE concurrent_users (id bigint)",
      "CREATE TABLE concurrent_users (id bigint)",
    ]);
    expect(mocks.saveResources).toHaveBeenCalledTimes(1);
  });

  it("reuses a fresh persisted DDL including an empty source", async () => {
    const target = identity("empty_source");
    const resource = storedDdl(target, "");
    mocks.resources.set(resource.id, resource);

    await expect(loadTableDdl(target, "TABLE")).resolves.toBe("");
    expect(mocks.getTableDdl).not.toHaveBeenCalled();
  });

  it("refreshes a persisted DDL older than the bounded cache age", async () => {
    const target = identity("expired_source");
    const resource = storedDdl(
      target,
      "old ddl",
      Date.now() - 25 * 60 * 60 * 1000,
    );
    mocks.resources.set(resource.id, resource);
    mocks.getTableDdl.mockResolvedValue("fresh ddl");

    await expect(loadTableDdl(target, "TABLE")).resolves.toBe("fresh ddl");
    expect(mocks.getTableDdl).toHaveBeenCalledTimes(1);
  });

  it("does not extend DDL freshness when unrelated metadata is newer", async () => {
    const target = identity("independent_source_age");
    const resource = storedDdl(
      target,
      "old ddl",
      Date.now(),
      Date.now() - 25 * 60 * 60 * 1000,
    );
    mocks.resources.set(resource.id, resource);
    mocks.getTableDdl.mockResolvedValue("fresh ddl");

    await expect(loadTableDdl(target, "TABLE")).resolves.toBe("fresh ddl");
    expect(mocks.getTableDdl).toHaveBeenCalledTimes(1);
  });

  it("makes normal readers join an active force refresh", async () => {
    const target = identity("force_refresh");
    const resource = storedDdl(target, "old ddl");
    mocks.resources.set(resource.id, resource);
    let resolve!: (ddl: string) => void;
    mocks.getTableDdl.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );

    const forced = loadTableDdl(target, "TABLE", true);
    const normal = loadTableDdl(target, "TABLE");
    await vi.waitFor(() => expect(mocks.getTableDdl).toHaveBeenCalledTimes(1));
    resolve("new ddl");

    await expect(Promise.all([forced, normal])).resolves.toEqual([
      "new ddl",
      "new ddl",
    ]);
  });

  it("does not let an invalidated in-flight DDL repopulate storage", async () => {
    const target = identity("invalidated_source");
    let resolve!: (ddl: string) => void;
    mocks.getTableDdl.mockReturnValueOnce(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );

    const staleLoad = loadTableDdl(target, "TABLE");
    await vi.waitFor(() => expect(mocks.getTableDdl).toHaveBeenCalledTimes(1));
    await invalidateTableMetadata(target);
    mocks.getTableDdl.mockResolvedValueOnce("fresh ddl");
    const freshLoad = loadTableDdl(target, "TABLE");
    resolve("stale ddl");

    await expect(staleLoad).rejects.toMatchObject({
      name: "MetadataCacheSupersededError",
    });
    await expect(freshLoad).resolves.toBe("fresh ddl");
    const savedMetadata = [...mocks.resources.values()].map(
      (resource) => resource.metadata,
    );
    expect(savedMetadata).toHaveLength(1);
    expect(savedMetadata[0].ddl).toBe("fresh ddl");
  });

  it("deduplicates view definition loads independently from table DDL", async () => {
    const target = identity("active_users");
    mocks.getTableDdl.mockResolvedValue("CREATE VIEW active_users AS SELECT 1");
    mocks.getViewDefinition.mockResolvedValue("SELECT 1");

    await expect(
      Promise.all([
        loadViewDefinition(target, "VIEW"),
        loadViewDefinition(target, "VIEW"),
        loadTableDdl(target, "VIEW"),
      ]),
    ).resolves.toEqual([
      "SELECT 1",
      "SELECT 1",
      "CREATE VIEW active_users AS SELECT 1",
    ]);
    expect(mocks.getViewDefinition).toHaveBeenCalledTimes(1);
    expect(mocks.getTableDdl).toHaveBeenCalledTimes(1);
  });

  it("returns oversized DDL without persisting it", async () => {
    const target = identity("oversized_source");
    mocks.getTableDdl.mockResolvedValue("x".repeat(5 * 1024 * 1024 + 1));

    await expect(loadTableDdl(target, "TABLE")).resolves.toHaveLength(
      5 * 1024 * 1024 + 1,
    );
    expect(mocks.saveResources).not.toHaveBeenCalled();
  });
});
