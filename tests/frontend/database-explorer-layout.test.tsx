// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SchemaSidebar } from "@/components/workspace/SchemaSidebar";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  useSchemaStore,
  getSchemaMetadataNodeKey,
} from "@/store/useSchemaStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/usePostgresDatabaseDiscovery", () => ({
  usePostgresDatabaseDiscovery: () => ({
    connectionId: "pg",
    databases: ["app"],
    status: "success",
    error: null,
  }),
}));
vi.mock("@/services/tauri", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/tauri")>();
  const { defaultDatabaseCapabilities } = await import("@/lib/databaseDialect");
  return {
    ...original,
    storeService: {
      ...original.storeService,
      getResources: vi.fn(async () => []),
      saveResources: vi.fn(async () => {}),
      replaceResources: vi.fn(async () => {}),
    },
    databaseService: {
      ...original.databaseService,
      getDatabaseCapabilities: vi.fn(async (driver: string) =>
        defaultDatabaseCapabilities(driver),
      ),
      listDatabaseCapabilities: vi.fn(async () => []),
      listDatabaseDriverInstallations: vi.fn(async () => []),
    },
    tableService: {
      ...original.tableService,
      listenTableExportProgress: vi.fn(async () => () => {}),
      listenTableImportProgress: vi.fn(async () => () => {}),
    },
    schemaService: {
      ...original.schemaService,
      getSchemaObjects: vi.fn(async () => []),
      getFunctions: vi.fn(async () => []),
      setCurrentSchema: vi.fn(async () => {}),
    },
  };
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  useProjectStore.setState({ activeProjectId: "explorer-layout" });
  useDatabaseExplorerStore.setState({ scopes: {} });
  useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
  useConnectionStore.setState({
    connections: [
      {
        id: "pg",
        name: "PostgreSQL",
        driver: "postgres",
        database: "app",
        url: "",
      },
    ],
    activeConnectionId: "pg",
    connectedConnectionIds: ["pg"],
    isConnected: true,
    isLoading: false,
    loadError: null,
  });
  useSchemaStore.getState().reset();
  useSchemaStore.setState({
    schemas: ["public"],
    currentSchema: "public",
    defaultSchema: "public",
    tables: [],
    isLoading: false,
    lastLoadedConnectionId: "explorer-layout:pg:postgres",
    loadTables: vi.fn(async () => {}),
    loadSchemas: vi.fn(async () => {}),
    loadFunctions: vi.fn(async () => {}),
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function mountExpanded() {
  await act(async () => root.render(<SchemaSidebar />));
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Expand database app"]')!
      .click(),
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Expand public"]')!
      .click(),
  );
}

it("shows an actionable schema failure instead of a successful empty table result", async () => {
  await mountExpanded();
  await act(async () => {
    useSchemaStore
      .getState()
      .setMetadataNodeState(
        getSchemaMetadataNodeKey("pg", "postgres", "public"),
        { status: "error", message: "Permission denied for schema public" },
      );
  });
  expect(host.textContent).toContain("Permission denied for schema public");
  expect(host.textContent).not.toContain("No tables found");
  expect(
    host.querySelector('[aria-label="Retry loading objects in public"]'),
  ).not.toBeNull();
  await act(async () => {
    useSchemaStore
      .getState()
      .setMetadataNodeState(
        getSchemaMetadataNodeKey("pg", "postgres", "public"),
        { status: "ready" },
      );
  });
  expect(host.textContent).toContain("No tables found");
  expect(
    host.querySelector('[aria-label="Retry loading objects in public"]'),
  ).toBeNull();
});

it("preserves the database parent when a cached connection becomes inactive", async () => {
  await mountExpanded();
  await act(async () => {
    useSchemaStore.getState().snapshotActiveMetadata();
    useConnectionStore.setState((state) => ({
      connections: [
        ...state.connections,
        {
          id: "mongo",
          name: "MongoDB",
          driver: "mongodb",
          database: "documents",
          url: "",
        },
      ],
      activeConnectionId: "mongo",
    }));
  });
  expect(host.querySelector('[data-postgres-database="app"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Discovering databases");
  expect(host.querySelector("#database-connection-pg")?.textContent).toContain(
    "Tables",
  );
  expect(
    host.querySelector("#database-connection-pg")?.textContent,
  ).not.toContain("Collections");
});
