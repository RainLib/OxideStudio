/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaSidebar } from "@/components/workspace/SchemaSidebar";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  setCurrentSchema: vi.fn(async () => "ok"),
  getCollectionsPage: vi.fn(
    async (_connectionId: string, database: string) => ({
      items: [
        {
          name: "session",
          namespace: database,
          type: "string",
          documentCount: null,
        },
      ],
      nextCursor: null,
      total: 1,
    }),
  ),
  executeQuery: vi.fn(async () => [
    {
      columns: [
        { name: "command", data_type: "text" },
        { name: "result", data_type: "json" },
      ],
      rows: [["GET session", "value"]],
    },
  ]),
}));

vi.mock("@/hooks/usePostgresDatabaseDiscovery", () => ({
  usePostgresDatabaseDiscovery: () => ({
    connectionId: null,
    databases: [],
    status: "idle",
    error: null,
  }),
}));

vi.mock("@/hooks/useTableOperations", () => ({
  useTableOperations: () => ({
    truncateTable: vi.fn(),
    dropTable: vi.fn(),
    renameTable: vi.fn(),
    exportTableData: vi.fn(),
    getTableDdl: vi.fn(async () => ""),
    getViewDefinition: vi.fn(async () => ""),
    refreshMaterializedView: vi.fn(),
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => undefined),
  },
  databaseService: {
    listDatabaseDriverInstallations: vi.fn(async () => []),
    getDatabaseCapabilities: vi.fn(async () => ({
      driver: "redis",
      displayName: "Redis",
      dataModel: "keyValue",
      namespaceLabel: "database",
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: true,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsFunctions: false,
    })),
  },
  queryService: {
    executeQuery: mocks.executeQuery,
  },
  schemaService: {
    getCollections: vi.fn(async () => []),
    getCollectionsPage: mocks.getCollectionsPage,
    getFunctions: vi.fn(async () => []),
    refreshSchemas: vi.fn(async () => ["0", "3"]),
    refreshTables: vi.fn(async () => []),
    setCurrentSchema: mocks.setCurrentSchema,
  },
  storeService: {
    deleteResources: vi.fn(async () => undefined),
    getResources: vi.fn(async () => []),
    replaceResources: vi.fn(async () => undefined),
    saveResources: vi.fn(async () => undefined),
  },
  tableService: {},
}));

describe("Database Explorer NoSQL navigation", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useProjectStore.setState({ activeProjectId: "project-redis" });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        databaseExplorer: {
          ...DEFAULT_APP_SETTINGS.databaseExplorer,
          showOnlySelectedSchemas: true,
        },
      },
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "redis-1",
          name: "Redis",
          driver: "redis",
          url: "redis://localhost:6379/0",
          database: "0",
        },
      ],
      activeConnectionId: "redis-1",
      connectedConnectionIds: ["redis-1"],
      isConnected: true,
      isLoading: false,
      loadError: null,
      selectedConnection: null,
    });
    useSchemaStore.getState().reset();
    useSchemaStore.setState({
      schemas: ["0", "3"],
      currentSchema: "0",
      defaultSchema: "0",
      collections: [],
      isLoading: false,
      isCollectionsLoading: false,
      lastLoadedConnectionId: "project-redis:redis-1:redis",
    });
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("shows Redis databases as nodes and opens a key in the data grid tab mode", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<SchemaSidebar />);
    });

    const databaseButton = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === label,
      );

    await vi.waitFor(() => {
      expect(databaseButton("db 0")).toBeDefined();
      expect(databaseButton("db 3")).toBeUndefined();
    });

    const connectionRow = container.querySelector<HTMLElement>(
      "#database-connection-redis-1 [role='button']",
    );
    const driverIcon = connectionRow?.querySelector<HTMLElement>(
      '[data-database-brand="redis"]',
    );
    const connectionStatus = connectionRow?.querySelector<HTMLElement>(
      '[aria-label="Connected"]',
    );
    expect(driverIcon?.nextElementSibling).toBe(connectionStatus);
    expect(connectionStatus?.nextElementSibling?.textContent).toContain("Redis");

    const visibilityButton = container.querySelector<HTMLButtonElement>(
      '[title="Select visible databases"]',
    );
    expect(visibilityButton).not.toBeNull();
    await act(async () => {
      visibilityButton!.click();
    });
    const db3VisibilityLabel = Array.from(
      document.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) => label.textContent?.trim() === "3");
    expect(db3VisibilityLabel).toBeDefined();
    await act(async () => {
      db3VisibilityLabel!
        .querySelector<HTMLButtonElement>('[role="checkbox"]')!
        .click();
    });
    await vi.waitFor(() => expect(databaseButton("db 3")).toBeDefined());

    await act(async () => {
      databaseButton("db 3")!.click();
    });
    expect(databaseButton("db 3")?.getAttribute("aria-expanded")).toBe("true");
    expect(useSchemaStore.getState().currentSchema).toBe("3");
    expect(mocks.setCurrentSchema).toHaveBeenCalledWith("redis-1", "3");

    await act(async () => {
      databaseButton("db 0")!.click();
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector<HTMLElement>('[title="session"]'),
      ).not.toBeNull(),
    );

    await act(async () => {
      container
        .querySelector<HTMLElement>('[title="session"]')!
        .click();
    });

    await vi.waitFor(() => {
      const tab = useTabStore.getState().tabs[0];
      expect(tab).toMatchObject({
        type: "table",
        connectionId: "redis-1",
        schemaName: "0",
        tableName: "session",
        sql: 'GET "session"',
      });
      expect(tab?.results?.[0]?.rows).toEqual([["GET session", "value"]]);
    });
  });
});
