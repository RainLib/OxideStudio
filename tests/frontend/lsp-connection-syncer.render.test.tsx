/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspConnectionSyncer } from "@/components/lsp";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  updateConfiguration: vi.fn(async () => undefined),
  getDatabaseCapabilities: vi.fn(),
  getTables: vi.fn(async () => []),
  getColumns: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  getConstraints: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
}));

vi.mock("@/hooks/useLspClient", () => ({
  useLspClient: () => ({
    isReady: true,
    error: null,
    client: { updateConfiguration: mocks.updateConfiguration },
  }),
}));

vi.mock("@/services/lsp", () => ({
  lspClient: {
    updateConfiguration: mocks.updateConfiguration,
  },
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  schemaService: {
    getTables: mocks.getTables,
    getColumns: mocks.getColumns,
    getIndexes: mocks.getIndexes,
    getConstraints: mocks.getConstraints,
    getFunctions: mocks.getFunctions,
  },
}));

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("LspConnectionSyncer render integration", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();

    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("postgres")
    );
    mocks.getTables.mockResolvedValue([
      {
        name: "users",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getColumns.mockResolvedValue([
      {
        name: "id",
        data_type: "integer",
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        comment: null,
      },
    ]);
    mocks.getIndexes.mockResolvedValue([]);
    mocks.getConstraints.mockResolvedValue([]);
    mocks.getFunctions.mockResolvedValue([]);

    useConnectionStore.setState({
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/postgres",
          database: "public",
        },
      ],
      activeConnectionId: "postgres-1",
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useSchemaStore.setState({
      schemas: ["public"],
      tables: [],
      collections: [],
      functions: [],
      pinnedTables: [],
      currentSchema: "public",
      defaultSchema: null,
      selectedTable: null,
      lastLoadedConnectionId: null,
      isLoading: false,
      isCollectionsLoading: false,
      isFunctionsLoading: false,
      metadataVersion: 1,
    });
    useTabStore.setState({
      activeTabId: "query-1",
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "SELECT * FROM users",
          connectionId: "postgres-1",
          targetSchema: "public",
          schemaName: "public",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      closedTabsStack: [],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.useRealTimers();
  });

  it("sends store-derived schema configuration through the LSP client", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getTables).toHaveBeenCalledWith("postgres-1", "public");
    expect(mocks.getColumns).toHaveBeenCalledWith(
      "postgres-1",
      "public",
      "users"
    );
    expect(mocks.updateConfiguration).toHaveBeenCalledTimes(1);

    const config = mocks.updateConfiguration.mock.calls[0][0];
    expect(config).toMatchObject({
      defaultDialect: "postgres",
      fileDialects: {
        "oxide://query/query-1.postgres.postgres": "postgres",
      },
      schemas: [
        {
          database: "public",
          tables: [
            {
              name: "users",
              columns: [
                {
                  name: "id",
                  data_type: "integer",
                  primary_key: true,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(
      config.fileSchemas["oxide://query/query-1.postgres.postgres"]
    ).toEqual(config.schemas[0].id);
  });
});
