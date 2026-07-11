import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadTableDdl,
  loadTableMetadata,
  loadViewDefinition,
  type TableMetadataIdentity,
} from "@/services/tableMetadataCache";
import type { ColumnInfo, ConstraintInfo, IndexInfo } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  getResources: vi.fn(),
  saveResources: vi.fn(),
  deleteResources: vi.fn(),
  getColumns: vi.fn(),
  getIndexes: vi.fn(),
  getConstraints: vi.fn(),
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
    getIndexes: mocks.getIndexes,
    getConstraints: mocks.getConstraints,
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

describe("table metadata cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getResources.mockResolvedValue([]);
    mocks.saveResources.mockResolvedValue(undefined);
    mocks.deleteResources.mockResolvedValue(undefined);
    mocks.getColumns.mockResolvedValue(columns);
    mocks.getIndexes.mockResolvedValue(indexes);
    mocks.getConstraints.mockResolvedValue(constraints);
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
    expect(mocks.saveResources).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "TABLE_METADATA_CACHE",
        parent_id: "postgres-1:postgres:public:users",
        metadata: expect.objectContaining({
          columns,
          indexes: [],
          constraints: [],
        }),
      }),
    ]);
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
});
