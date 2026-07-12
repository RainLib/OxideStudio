import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTableDdl,
  loadTableMetadata,
  loadViewDefinition,
  tableMetadataParentId,
  type TableMetadataIdentity,
} from "@/services/tableMetadataCache";
import type { ColumnInfo, ConstraintInfo, IndexInfo } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  getResources: vi.fn(),
  saveResources: vi.fn(),
  deleteResources: vi.fn(),
  getColumns: vi.fn(),
  getDatabaseColumns: vi.fn(),
  getIndexes: vi.fn(),
  getDatabaseIndexes: vi.fn(),
  getConstraints: vi.fn(),
  getDatabaseConstraints: vi.fn(),
  getTableDdl: vi.fn(),
  getViewDefinition: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  storeService: {
    getResources: mocks.getResources,
    saveResources: mocks.saveResources,
    deleteResources: mocks.deleteResources,
  },
  schemaService: {
    getColumns: mocks.getColumns,
    getDatabaseColumns: mocks.getDatabaseColumns,
    getIndexes: mocks.getIndexes,
    getDatabaseIndexes: mocks.getDatabaseIndexes,
    getConstraints: mocks.getConstraints,
    getDatabaseConstraints: mocks.getDatabaseConstraints,
  },
  tableService: {
    getTableDdl: mocks.getTableDdl,
    getViewDefinition: mocks.getViewDefinition,
  },
}));

const identity: TableMetadataIdentity = {
  connectionId: "postgres-1",
  driver: "postgres",
  schema: "public",
  table: "users",
};

const columns: ColumnInfo[] = [
  {
    name: "id",
    data_type: "int4",
    is_nullable: false,
    is_primary_key: true,
  },
];
const indexes: IndexInfo[] = [
  {
    name: "users_pkey",
    columns: ["id"],
    is_unique: true,
    is_primary: true,
  },
];
const constraints: ConstraintInfo[] = [
  {
    name: "users_pkey",
    constraint_type: "PRIMARY KEY",
    columns: ["id"],
    referenced_columns: [],
  },
];

function cachedResource(overrides: Record<string, unknown> = {}) {
  return {
    id: "postgres-1:postgres:public:users:TABLE_METADATA_CACHE",
    connection_id: "postgres-1",
    parent_id: "postgres-1:postgres:public:users",
    kind: "TABLE_METADATA_CACHE",
    name: "users",
    metadata: {
      version: 1,
      driver: "postgres",
      schema: "public",
      table: "users",
      columns,
      indexes,
      constraints,
      ...overrides,
    },
    last_updated: 1234,
  };
}

function cachedDatabaseResource(
  databaseName: string,
  projectId = "project-a"
) {
  const databaseIdentity: TableMetadataIdentity = {
    ...identity,
    projectId,
    databaseName,
  };
  const parentId = tableMetadataParentId(databaseIdentity);
  return {
    id: `${parentId}:TABLE_METADATA_CACHE`,
    project_id: projectId,
    connection_id: identity.connectionId,
    parent_id: parentId,
    kind: "TABLE_METADATA_CACHE",
    name: identity.table,
    metadata: {
      version: 2,
      projectId,
      driver: identity.driver,
      databaseName,
      schema: identity.schema,
      table: identity.table,
      columns,
      indexes,
      constraints,
    },
    last_updated: 4321,
  };
}

describe("table metadata cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getResources.mockResolvedValue([]);
    mocks.saveResources.mockResolvedValue(undefined);
    mocks.deleteResources.mockResolvedValue(undefined);
    mocks.getColumns.mockResolvedValue(columns);
    mocks.getDatabaseColumns.mockResolvedValue(columns);
    mocks.getIndexes.mockResolvedValue(indexes);
    mocks.getDatabaseIndexes.mockResolvedValue(indexes);
    mocks.getConstraints.mockResolvedValue(constraints);
    mocks.getDatabaseConstraints.mockResolvedValue(constraints);
    mocks.getTableDdl.mockResolvedValue("CREATE TABLE users (id int primary key);");
    mocks.getViewDefinition.mockResolvedValue("select id from users");
  });

  it("returns a complete SQLite snapshot without introspecting the database", async () => {
    mocks.getResources.mockResolvedValue([cachedResource()]);

    const metadata = await loadTableMetadata(identity);

    expect(metadata.source).toBe("cache");
    expect(metadata.columns).toEqual(columns);
    expect(metadata.indexes).toEqual(indexes);
    expect(metadata.constraints).toEqual(constraints);
    expect(mocks.getColumns).not.toHaveBeenCalled();
    expect(mocks.getIndexes).not.toHaveBeenCalled();
    expect(mocks.getConstraints).not.toHaveBeenCalled();
  });

  it("introspects once on a cache miss and stores empty metadata groups", async () => {
    mocks.getIndexes.mockResolvedValue([]);
    mocks.getConstraints.mockResolvedValue([]);

    const metadata = await loadTableMetadata(identity);

    expect(metadata.source).toBe("remote");
    expect(mocks.getColumns).toHaveBeenCalledOnce();
    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          project_id: "sqls",
          kind: "TABLE_METADATA_CACHE",
          parent_id: "postgres-1:postgres:public:users",
          metadata: expect.objectContaining({
            columns,
            indexes: [],
            constraints: [],
          }),
        }),
      ],
      "sqls"
    );
  });

  it("does not mark metadata groups as cached when they were not requested", async () => {
    await loadTableMetadata({
      ...identity,
      includeIndexes: false,
      includeConstraints: false,
    });

    const savedResource = mocks.saveResources.mock.calls[0]?.[0]?.[0];
    expect(savedResource.metadata.columns).toEqual(columns);
    expect(savedResource.metadata).not.toHaveProperty("indexes");
    expect(savedResource.metadata).not.toHaveProperty("constraints");
    expect(mocks.getIndexes).not.toHaveBeenCalled();
    expect(mocks.getConstraints).not.toHaveBeenCalled();
  });

  it("forces remote introspection only for an explicit refresh", async () => {
    mocks.getResources.mockResolvedValue([cachedResource()]);
    const refreshedColumns = [{ ...columns[0]!, name: "account_id" }];
    mocks.getColumns.mockResolvedValue(refreshedColumns);

    const metadata = await loadTableMetadata({ ...identity, force: true });

    expect(metadata.source).toBe("remote");
    expect(metadata.columns).toEqual(refreshedColumns);
    expect(mocks.getColumns).toHaveBeenCalledOnce();
    expect(mocks.saveResources).toHaveBeenCalled();
  });

  it("serves cached DDL and view definitions without database calls", async () => {
    mocks.getResources.mockResolvedValue([
      cachedResource({
        ddl: "cached ddl",
        ddlObjectType: "BASE TABLE",
        viewDefinition: "cached view query",
        viewObjectType: "VIEW",
      }),
    ]);

    await expect(loadTableDdl(identity, "BASE TABLE")).resolves.toBe(
      "cached ddl"
    );
    await expect(
      loadViewDefinition(identity, "VIEW")
    ).resolves.toBe("cached view query");
    expect(mocks.getTableDdl).not.toHaveBeenCalled();
    expect(mocks.getViewDefinition).not.toHaveBeenCalled();
  });

  it("loads and stores metadata under an explicit project and database", async () => {
    const databaseIdentity: TableMetadataIdentity = {
      ...identity,
      projectId: "project-a",
      databaseName: "analytics",
    };

    const metadata = await loadTableMetadata(databaseIdentity);

    expect(metadata.source).toBe("remote");
    expect(mocks.getColumns).not.toHaveBeenCalled();
    expect(mocks.getIndexes).not.toHaveBeenCalled();
    expect(mocks.getConstraints).not.toHaveBeenCalled();
    expect(mocks.getDatabaseColumns).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
      "users"
    );
    expect(mocks.getDatabaseIndexes).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
      "users"
    );
    expect(mocks.getDatabaseConstraints).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
      "users"
    );
    expect(mocks.getResources).toHaveBeenCalledWith(
      "postgres-1",
      tableMetadataParentId(databaseIdentity),
      "project-a"
    );
    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          project_id: "project-a",
          parent_id: tableMetadataParentId(databaseIdentity),
          metadata: expect.objectContaining({
            version: 2,
            projectId: "project-a",
            databaseName: "analytics",
          }),
        }),
      ],
      "project-a"
    );
  });

  it("loads and caches DDL from an explicitly selected PostgreSQL database", async () => {
    const databaseIdentity: TableMetadataIdentity = {
      ...identity,
      projectId: "project-a",
      databaseName: "analytics",
    };

    await expect(
      loadTableDdl(databaseIdentity, "BASE TABLE")
    ).resolves.toContain("CREATE TABLE");

    expect(mocks.getTableDdl).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      "BASE TABLE",
      "analytics"
    );
    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          project_id: "project-a",
          parent_id: tableMetadataParentId(databaseIdentity),
          metadata: expect.objectContaining({
            databaseName: "analytics",
            ddl: expect.stringContaining("CREATE TABLE"),
          }),
        }),
      ],
      "project-a"
    );
  });

  it("does not reuse same-named table metadata from another database", async () => {
    mocks.getResources.mockResolvedValue([
      cachedDatabaseResource("analytics"),
    ]);

    const metadata = await loadTableMetadata({
      ...identity,
      projectId: "project-a",
      databaseName: "archive",
    });

    expect(metadata.source).toBe("remote");
    expect(mocks.getDatabaseColumns).toHaveBeenCalledWith(
      "postgres-1",
      "archive",
      "public",
      "users"
    );
    expect(
      tableMetadataParentId({
        ...identity,
        projectId: "project-a",
        databaseName: "archive",
      })
    ).not.toBe(
      tableMetadataParentId({
        ...identity,
        projectId: "project-a",
        databaseName: "analytics",
      })
    );
  });
});
