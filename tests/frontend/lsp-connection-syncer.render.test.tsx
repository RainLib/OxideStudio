/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspConnectionSyncer } from "@/components/lsp";
import {
  defaultDatabaseCapabilities,
  registerDatabaseCapabilities,
  resetRuntimeDatabaseCatalogForTests,
} from "@/lib/databaseDialect";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useLspSemanticStatusStore } from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";

const mocks = vi.hoisted(() => ({
  processSnapshot:{ready:true,generation:{}},processListeners:new Set<()=>void>(),confirmConfig:vi.fn(async()=>true),
  getRuntimeSnapshot:vi.fn(),subscribeRuntime:vi.fn(()=>()=>{}),
  updateConfiguration: vi.fn(async () => undefined),
  getConnectionSemanticState: vi.fn(),
  didOpen: vi.fn(async () => undefined),
  didChange: vi.fn(async () => undefined),
  didClose: vi.fn(async () => undefined),
  getSessionKey: vi.fn(() => "postgres-1"),
  getLspDocuments: vi.fn(async () => []),
  getServerVersion: vi.fn(async () => "16.2"),
  getDatabaseCapabilities: vi.fn(),
  getConnectionDatabaseCapabilityContext: vi.fn(),
  getTables: vi.fn(async () => []),
  getDatabaseTables: vi.fn(async () => []),
  getCollections: vi.fn(async () => []),
  getCollectionsPage: vi.fn(async () => ({
    items: [],
    nextCursor: null,
    total: 0,
  })),
  getColumns: vi.fn(async () => []),
  getDatabaseColumns: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  getDatabaseIndexes: vi.fn(async () => []),
  getConstraints: vi.fn(async () => []),
  getDatabaseConstraints: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
  getDatabaseFunctions: vi.fn(async () => []),
  getResources: vi.fn(async () => []),
  saveResources: vi.fn(async () => undefined),
}));
vi.mock("@/services/tauri/semantic-context.service",()=>({getConnectionSemanticState:mocks.getConnectionSemanticState,listenConnectionSemanticState:vi.fn(async()=>()=>{})}));

vi.mock("@/hooks/useLspClient", () => ({
  useLspClient: () => ({
    isReady: true,
    error: null,
    client: {
      confirmAnalysisConfiguration: mocks.confirmConfig,
      getRuntimeSnapshot:()=>mocks.processSnapshot,subscribeRuntime:mocks.subscribeRuntime,
      updateConfiguration: mocks.updateConfiguration,
      didOpen: mocks.didOpen,
      didChange: mocks.didChange,
      didClose: mocks.didClose,
      getSessionKey: mocks.getSessionKey,
    },
  }),
}));

vi.mock("@/services/lsp", () => ({
  lspClient: {
    confirmAnalysisConfiguration: mocks.confirmConfig,
      updateConfiguration: mocks.updateConfiguration,
  },
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    getServerVersion: mocks.getServerVersion,
  },
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
    getConnectionDatabaseCapabilityContext:
      mocks.getConnectionDatabaseCapabilityContext,
  },
  projectFilesService: {
    getLspDocuments: mocks.getLspDocuments,
  },
  schemaService: {
    getTables: mocks.getTables,
    getDatabaseTables: mocks.getDatabaseTables,
    getCollections: mocks.getCollections,
    getCollectionsPage: mocks.getCollectionsPage,
    getColumns: mocks.getColumns,
    getDatabaseColumns: mocks.getDatabaseColumns,
    getIndexes: mocks.getIndexes,
    getDatabaseIndexes: mocks.getDatabaseIndexes,
    getConstraints: mocks.getConstraints,
    getDatabaseConstraints: mocks.getDatabaseConstraints,
    getFunctions: mocks.getFunctions,
    getDatabaseFunctions: mocks.getDatabaseFunctions,
  },
  storeService: {
    getResources: mocks.getResources,
    saveResources: mocks.saveResources,
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
    mocks.processSnapshot={ready:true,generation:{}};mocks.processListeners.clear();mocks.confirmConfig.mockReset().mockResolvedValue(true);
    mocks.subscribeRuntime.mockImplementation(listener=>{mocks.processListeners.add(listener);return ()=>{mocks.processListeners.delete(listener);};});
    localStorage.clear();
    useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});
    mocks.getConnectionSemanticState.mockImplementation(async(id:string)=>useConnectionSemanticStore.getState().byConnectionId[id]?.state||null);

    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("postgres"),
    );
    mocks.getServerVersion.mockResolvedValue("16.2");
    mocks.getConnectionDatabaseCapabilityContext.mockImplementation(
      async (connectionId: string) => {
        const capabilities = await mocks.getDatabaseCapabilities();
        const serverVersion = await mocks.getServerVersion(connectionId);
        return {
          connectionId,
          driver: capabilities.driver,
          distribution: "bundled",
          packageVersion: null,
          serverVersion,
          schemaMigrationMode: "transactional",
          capabilities,
        };
      },
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
        is_generated: false,
        is_hidden: false,
        comment: null,
      },
    ]);
    mocks.getDatabaseTables.mockResolvedValue([
      {
        name: "events",
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      },
    ]);
    mocks.getDatabaseColumns.mockResolvedValue([
      {
        name: "event_id",
        data_type: "bigint",
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        is_generated: false,
        is_hidden: false,
        comment: null,
      },
    ]);
    mocks.getIndexes.mockResolvedValue([]);
    mocks.getConstraints.mockResolvedValue([]);
    mocks.getFunctions.mockResolvedValue([]);
    mocks.getDatabaseIndexes.mockResolvedValue([]);
    mocks.getDatabaseConstraints.mockResolvedValue([]);
    mocks.getDatabaseFunctions.mockResolvedValue([]);
    mocks.getCollections.mockResolvedValue([]);
    mocks.getCollectionsPage.mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    });
    mocks.getResources.mockResolvedValue([]);
    mocks.saveResources.mockResolvedValue(undefined);
    mocks.getLspDocuments.mockResolvedValue([]);

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
      connectionRuntimeStates: {},
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
    useProjectStore.setState({
      projects: [{ id: "sqls", name: "sqls", created_at: 0, updated_at: 0 }],
      activeProjectId: "sqls",
      activeProjectName: "sqls",
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
    resetRuntimeDatabaseCatalogForTests();
    vi.useRealTimers();
  });

  it("revalidates a same-id replacement session and bypasses its persisted table metadata", async () => {
    const runtime = {status: "connected" as const, updatedAt: 1};
    useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": runtime}});
    await act(async () => { root = createRoot(container); root.render(<LspConnectionSyncer />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    const oldResource = mocks.saveResources.mock.calls.at(-1)?.[0];
    expect(oldResource).toBeDefined();
    mocks.getResources.mockResolvedValue(oldResource);
    mocks.getColumns.mockResolvedValue([{name: "new_session_value", data_type: "bigint", is_nullable: false, is_generated: false, is_hidden: false}]);
    mocks.getServerVersion.mockResolvedValue("17.0");
    await act(async () => {
      useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connecting", updatedAt: 1}}});
      await flushAsyncWork();
    });
    expect(mocks.updateConfiguration.mock.calls.at(-1)?.[0]).toMatchObject({schemas: []});
    const requestsWhileConnecting = mocks.getConnectionDatabaseCapabilityContext.mock.calls.length;
    await act(async () => {
      useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 1}}});
      await flushAsyncWork();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    expect(mocks.getConnectionDatabaseCapabilityContext.mock.calls.length).toBe(requestsWhileConnecting + 1);
    expect(mocks.getColumns).toHaveBeenCalledTimes(2);
    const config = mocks.updateConfiguration.mock.calls.at(-1)?.[0];
    expect(config.schemas[0].tables[0].columns).toMatchObject([{name: "new_session_value", data_type: "bigint"}]);
    // Unrelated store publications cannot force a third metadata scan.
    await act(async () => { useConnectionStore.setState({isLoading: true}); await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.getColumns).toHaveBeenCalledTimes(2);
  });

  it("does not publish a late table response from a replaced session", async () => {
    let finishOld!: (columns: unknown[]) => void;
    mocks.getColumns.mockImplementationOnce(() => new Promise(resolve => {finishOld = resolve;}));
    useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 1}}});
    await act(async () => { root = createRoot(container); root.render(<LspConnectionSyncer />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    expect(finishOld).toBeDefined();
    mocks.getColumns.mockResolvedValue([{name: "replacement_value", data_type: "text", is_nullable: true, is_generated: false, is_hidden: false}]);
    await act(async () => {
      useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 1}}});
      await flushAsyncWork();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    const afterReplacement = mocks.updateConfiguration.mock.calls.length;
    await act(async () => { finishOld([{name: "stale_value", data_type: "integer", is_nullable: false}]); await flushAsyncWork(); });
    expect(mocks.updateConfiguration).toHaveBeenCalledTimes(afterReplacement);
    expect(mocks.updateConfiguration.mock.calls.at(-1)?.[0].schemas[0].tables[0].columns).toMatchObject([{name: "replacement_value"}]);
  });

  it("refreshes columns after a metadata revision instead of republishing persisted pre-DDL fields", async () => {
    await act(async () => { root = createRoot(container); root.render(<LspConnectionSyncer />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    const oldResource = mocks.saveResources.mock.calls.at(-1)?.[0];
    mocks.getResources.mockResolvedValue(oldResource);
    mocks.getColumns.mockResolvedValue([{name: "after_ddl", data_type: "text", is_nullable: true, is_generated: false, is_hidden: false}]);
    await act(async () => { useSchemaStore.getState().bumpMetadataVersion(); await flushAsyncWork(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    expect(mocks.getColumns).toHaveBeenCalledTimes(2);
    expect(mocks.updateConfiguration.mock.calls.at(-1)?.[0].schemas[0].tables[0].columns).toMatchObject([{name: "after_ddl"}]);
  });

  it("waits for the previous context to be cleared before loading replacement metadata", async () => {
    useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 1}}});
    await act(async () => { root = createRoot(container); root.render(<LspConnectionSyncer />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    let finishReset!: () => void;
    mocks.updateConfiguration.mockImplementationOnce(() => new Promise<void>(resolve => {finishReset = resolve;}));
    await act(async () => {
      useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 2}}});
      await flushAsyncWork();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    expect(mocks.getColumns).toHaveBeenCalledTimes(1);
    await act(async () => { finishReset(); await flushAsyncWork(); });
    expect(mocks.getColumns).toHaveBeenCalledTimes(2);
  });

  it("reports reset failure and does not claim a synchronized replacement context", async () => {
    useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 1}}});
    await act(async () => { root = createRoot(container); root.render(<LspConnectionSyncer />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    mocks.updateConfiguration.mockRejectedValueOnce(new Error("reset transport failed"));
    await act(async () => {
      useConnectionStore.setState({connectionRuntimeStates: {"postgres-1": {status: "connected", updatedAt: 2}}});
      await flushAsyncWork();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); await flushAsyncWork(); });
    expect(mocks.getColumns).toHaveBeenCalledTimes(1);
    expect(useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]?.state).toBe("error");
  });

  it("coalesces a burst of same-connection operations into one fresh idle metadata scan",async()=>{
    const owner={},authority=useConnectionSemanticStore.getState();authority.claim(owner);authority.listening(owner);
    const advance=(revision:number,activeOperations=0,connectionId="postgres-1")=>authority.accept(owner,{connectionId,session:"session",revision,activeOperations,openTransactions:0,connected:true,uncertain:false});
    advance(1);await act(async()=>{root=createRoot(container);root.render(<LspConnectionSyncer/>);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});expect(mocks.getColumns).toHaveBeenCalledTimes(1);
    await act(async()=>{for(let i=2;i<42;i++)advance(i,i%2===0?1:0);await flushAsyncWork();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(499);});expect(mocks.getColumns).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);await flushAsyncWork();});expect(mocks.getColumns).toHaveBeenCalledTimes(2);
    expect(useSchemaStore.getState().metadataVersion).toBe(1);
    await act(async()=>{advance(100,0,"other");await vi.advanceTimersByTimeAsync(1000);});expect(mocks.getColumns).toHaveBeenCalledTimes(2);
  });
  it("holds metadata during transactions and uncertain cancellation until a replacement session is observed",async()=>{
    const owner={},authority=useConnectionSemanticStore.getState();authority.claim(owner);authority.listening(owner);
    const initial={connectionId:"postgres-1",session:"old",revision:1,activeOperations:0,openTransactions:1,connected:true,uncertain:false};authority.accept(owner,initial);
    await act(async()=>{root=createRoot(container);root.render(<LspConnectionSyncer/>);await vi.advanceTimersByTimeAsync(1000);});expect(mocks.getColumns).not.toHaveBeenCalled();
    await act(async()=>{authority.accept(owner,{...initial,revision:2,openTransactions:0,uncertain:true});await vi.advanceTimersByTimeAsync(1000);});expect(mocks.getColumns).not.toHaveBeenCalled();
    await act(async()=>{authority.accept(owner,{...initial,session:"new",revision:3,openTransactions:0});await flushAsyncWork();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});expect(mocks.getColumns).toHaveBeenCalledTimes(1);
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
      "users",
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
      config.fileSchemas["oxide://query/query-1.postgres.postgres"],
    ).toEqual(config.schemas[0].id);
  });

  it("keeps generic SQL documents mapped to the concrete LSP server baseline", async () => {
    const externalCapabilities = {
      ...defaultDatabaseCapabilities("postgres"),
      driver: "trino",
      displayName: "Trino",
      lspLanguageId: "trino",
    };
    registerDatabaseCapabilities(externalCapabilities);
    mocks.getDatabaseCapabilities.mockResolvedValue(externalCapabilities);
    useConnectionStore.setState((state) => ({
      ...state,
      connections: [
        {
          id: "postgres-1",
          name: "Trino",
          driver: "trino",
          url: "jdbc:trino://localhost:8080",
          database: "hive",
        },
      ],
    }));

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    const config = mocks.updateConfiguration.mock.calls.at(-1)?.[0];
    expect(config.defaultDialect).toBe("postgres");
    expect(config.fileDialects).toEqual({
      "oxide://query/query-1.trino.sql": "postgres",
    });
  });

  it("binds saved project SQL documents to the active schema before opening them", async () => {
    mocks.getLspDocuments.mockResolvedValue([
      { relativePath: "queries/report.sql", content: "SELECT * FROM users;" },
    ]);
    useProjectStore.setState({
      projects: [
        {
          id: "project-1",
          name: "project",
          root_path: "/workspace/project",
          created_at: 0,
          updated_at: 0,
        },
      ],
      activeProjectId: "project-1",
      activeProjectName: "project",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getLspDocuments).toHaveBeenCalledWith({
      projectId: "project-1",
      expectedRoot: "/workspace/project",
    });
    const config = mocks.updateConfiguration.mock.calls.at(-1)?.[0];
    expect(
      config.fileDialects["oxide://project/project-1/queries/report.sql"],
    ).toBe("postgres");
    expect(mocks.didOpen).toHaveBeenCalledWith(
      "oxide://project/project-1/queries/report.sql",
      "SELECT * FROM users;",
      1,
      "postgres",
    );
  });

  it("closes project SQL virtual documents when their project root is removed", async () => {
    mocks.getLspDocuments.mockResolvedValue([
      { relativePath: "queries/report.sql", content: "SELECT * FROM users;" },
    ]);
    useProjectStore.setState({
      projects: [
        {
          id: "project-1",
          name: "project",
          root_path: "/workspace/project",
          created_at: 0,
          updated_at: 0,
        },
      ],
      activeProjectId: "project-1",
      activeProjectName: "project",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.didOpen).toHaveBeenCalledWith(
      "oxide://project/project-1/queries/report.sql",
      "SELECT * FROM users;",
      1,
      "postgres",
    );

    await act(async () => {
      useProjectStore.setState({
        projects: [
          {
            id: "project-1",
            name: "project",
            root_path: null,
            created_at: 0,
            updated_at: 0,
          },
        ],
      });
      await flushAsyncWork();
    });

    expect(mocks.didClose).toHaveBeenCalledWith(
      "oxide://project/project-1/queries/report.sql",
    );
  });

  it("closes a project document whose open finishes after the root is removed", async () => {
    let finishOpen!: () => void;
    const opening = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    mocks.didOpen.mockImplementationOnce(() => opening);
    mocks.getLspDocuments.mockResolvedValue([
      { relativePath: "queries/report.sql", content: "SELECT * FROM users;" },
    ]);
    useProjectStore.setState({
      projects: [
        {
          id: "project-1",
          name: "project",
          root_path: "/workspace/project",
          created_at: 0,
          updated_at: 0,
        },
      ],
      activeProjectId: "project-1",
      activeProjectName: "project",
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });
    expect(mocks.didOpen).toHaveBeenCalledOnce();
    await act(async () => {
      useProjectStore.setState({
        projects: [
          {
            id: "project-1",
            name: "project",
            root_path: null,
            created_at: 0,
            updated_at: 0,
          },
        ],
      });
      await flushAsyncWork();
    });
    await act(async () => {
      finishOpen();
      await flushAsyncWork();
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.didClose).toHaveBeenCalledWith(
      "oxide://project/project-1/queries/report.sql",
    );
    expect(mocks.didOpen).toHaveBeenCalledOnce();
  });

  it("closes project SQL virtual documents after the final connection query tab closes", async () => {
    mocks.getLspDocuments.mockResolvedValue([
      { relativePath: "queries/report.sql", content: "SELECT * FROM users;" },
    ]);
    useProjectStore.setState({
      projects: [
        {
          id: "project-1",
          name: "project",
          root_path: "/workspace/project",
          created_at: 0,
          updated_at: 0,
        },
      ],
      activeProjectId: "project-1",
      activeProjectName: "project",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    useTabStore.setState({ activeTabId: null, tabs: [] });
    await act(async () => {
      await flushAsyncWork();
    });

    expect(mocks.didClose).toHaveBeenCalledWith(
      "oxide://project/project-1/queries/report.sql",
    );
  });

  it("publishes every table and function before enriching a large catalog", async () => {
    mocks.getTables.mockResolvedValue(
      Array.from({ length: 205 }, (_, index) => ({
        name: `table_${index}`,
        schema: "public",
        type: "BASE TABLE",
        comment: null,
      })),
    );
    mocks.getFunctions.mockResolvedValue(
      Array.from({ length: 230 }, (_, index) => ({
        name: `function_${index}`,
        routine_type: "FUNCTION",
        parameters: [],
        return_type: "integer",
        description: null,
      })),
    );

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.updateConfiguration).toHaveBeenCalled();
    const firstConfig = mocks.updateConfiguration.mock.calls[0][0];
    expect(firstConfig.schemas[0].tables).toHaveLength(205);
    expect(firstConfig.schemas[0].functions).toHaveLength(230);
    expect(firstConfig.schemas[0].tables[204].name).toBe("table_204");
  });

  it("uses database-scoped metadata and schema ids for a PostgreSQL catalog tab", async () => {
    useTabStore.setState({
      activeTabId: "analytics-query",
      tabs: [
        {
          id: "analytics-query",
          title: "Analytics",
          type: "query",
          sql: "SELECT event_id FROM events",
          connectionId: "postgres-1",
          databaseName: "analytics",
          targetSchema: "public",
          schemaName: "public",
          tableName: "events",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getDatabaseTables).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
    );
    expect(mocks.getDatabaseColumns).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
      "events",
    );
    expect(mocks.getTables).not.toHaveBeenCalled();

    const config = mocks.updateConfiguration.mock.calls.at(-1)?.[0];
    expect(config.schemas).toEqual([
      expect.objectContaining({
        catalog: "analytics",
        database: "public",
        tables: [
          expect.objectContaining({
            name: "events",
            columns: [expect.objectContaining({ name: "event_id" })],
          }),
        ],
      }),
    ]);
    expect(
      config.fileSchemas["oxide://query/analytics-query.postgres.postgres"],
    ).toBe(config.schemas[0].id);
    expect(config.schemas[0].id).toBe(
      localStorage.getItem(
        `oxide-lsp-schema-id:v2:${encodeURIComponent(
          JSON.stringify(["postgres-1", "postgres", "analytics", "public"]),
        )}`,
      ),
    );
  });

  it("publishes every collection instead of truncating document catalogs", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("mongodb"),
    );
    mocks.getServerVersion.mockResolvedValue("5.0.14");
    mocks.getCollections.mockResolvedValue(
      Array.from({ length: 505 }, (_, index) => ({
        name: `collection_${index}`,
        type: "collection",
        documentCount: index,
      })),
    );
    useConnectionStore.setState({
      connections: [
        {
          id: "mongo-1",
          name: "MongoDB",
          driver: "mongodb",
          url: "mongodb://localhost/app",
          database: "app",
        },
      ],
      activeConnectionId: "mongo-1",
    });
    useSchemaStore.setState({
      schemas: ["app"],
      currentSchema: "app",
    });
    useTabStore.setState({
      activeTabId: "query-1",
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "db.collection_504.find({})",
          connectionId: "mongo-1",
          targetSchema: "app",
          schemaName: "app",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.updateConfiguration).toHaveBeenCalled();
    const firstConfig = mocks.updateConfiguration.mock.calls[0][0];
    expect(firstConfig.schemas[0].tables).toHaveLength(505);
    expect(
      firstConfig.schemas[0].tables.some(
        (table: { name: string }) => table.name === "collection_504",
      ),
    ).toBe(true);
    // The bundled Mongo service gates aggregation stages by server version;
    // the version has to travel with the schema config rather than live only
    // in the connection banner.
    expect(firstConfig.schemas[0].server_version).toBe("5.0.14");
  });

  it("does not introspect Redis when no query tab targets the connection", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("redis"),
    );
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
    });
    useSchemaStore.setState({ schemas: ["0"], currentSchema: "0" });
    useTabStore.setState({ tabs: [], activeTabId: null });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getCollections).not.toHaveBeenCalled();
    expect(mocks.getCollectionsPage).not.toHaveBeenCalled();
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
  });

  it("syncs a bounded Redis key page into the active LSP session", async () => {
    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("redis"),
    );
    mocks.getCollections.mockResolvedValue([
      {
        name: "user:1",
        type: "hash",
        documentCount: 3,
      },
      {
        name: "session:1",
        type: "string",
        documentCount: 1,
      },
    ]);
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
    });
    useSchemaStore.setState({ schemas: ["0"], currentSchema: "0" });
    useTabStore.setState({
      activeTabId: "redis-query",
      tabs: [
        {
          id: "redis-query",
          title: "Redis",
          type: "query",
          sql: "GET key:1",
          connectionId: "redis-1",
          targetSchema: "0",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<LspConnectionSyncer />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await flushAsyncWork();
    });

    expect(mocks.getCollections).toHaveBeenCalledWith("redis-1", "0");
    expect(mocks.getCollectionsPage).not.toHaveBeenCalled();
    expect(mocks.updateConfiguration).toHaveBeenCalledTimes(1);
    const config = mocks.updateConfiguration.mock.calls[0][0];
    expect(config).toMatchObject({
      defaultDialect: "redis",
      fileDialects: {
        "oxide://query/redis-query.redis.redis": "redis",
      },
      schemas: [
        {
          database: "0",
          tables: [
            {
              name: "user:1",
              object_type: "hash",
              columns: [
                { name: "key", data_type: "string" },
                { name: "type", data_type: "hash" },
                { name: "value", data_type: "json" },
              ],
            },
            {
              name: "session:1",
              object_type: "string",
            },
          ],
        },
      ],
    });
    expect(config.schemas[0].tables[0].source_location[0]).toContain(
      "oxide://database-object/object",
    );
  });
  it("reacquires an LSP process receipt while reusing unchanged database metadata",async()=>{
    await act(async()=>{root=createRoot(container);root.render(<LspConnectionSyncer/>);});await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});
    const oldToken=useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]?.context?.analysisToken;
    expect(oldToken).toBeTruthy();const reads=mocks.getColumns.mock.calls.length+mocks.getDatabaseColumns.mock.calls.length,capabilities=mocks.getConnectionDatabaseCapabilityContext.mock.calls.length;
    await act(async()=>{mocks.processSnapshot={ready:true,generation:{}};for(const listener of mocks.processListeners)listener();await flushAsyncWork();});
    expect(useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]?.context?.analysisToken).not.toBeTruthy();
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});
    const status=useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]!;
    expect(status.context?.analysisToken).toBeTruthy();expect(status.context?.analysisToken).not.toBe(oldToken);expect(status.context?.identity.lspRuntime).toBe(mocks.processSnapshot.generation);
    expect(mocks.getColumns.mock.calls.length+mocks.getDatabaseColumns.mock.calls.length).toBe(reads);expect(mocks.getConnectionDatabaseCapabilityContext).toHaveBeenCalledTimes(capabilities);
  });
  it("does not mark a newly sent configuration ready before server confirmation",async()=>{
    let confirm!:(value:boolean)=>void;mocks.confirmConfig.mockImplementation(()=>new Promise<boolean>(resolve=>{confirm=resolve;}));
    await act(async()=>{root=createRoot(container);root.render(<LspConnectionSyncer/>);});await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});
    const status=useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]!;expect(mocks.updateConfiguration).toHaveBeenCalled();expect(mocks.confirmConfig).toHaveBeenCalled();
    expect(status.context?.analysisToken).toBeUndefined();expect(status.context?.sourcesReady).toBe(false);expect(status.context?.metadataReady).toBe(false);
    mocks.confirmConfig.mockResolvedValue(true);await act(async()=>{confirm(true);await flushAsyncWork();});expect(useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]?.context?.sourcesReady).toBe(true);
  });
  it("rejects an old pending configuration confirmation after a quick process replacement",async()=>{
    let finish!:(value:boolean)=>void;mocks.confirmConfig.mockImplementationOnce(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
    await act(async()=>{root=createRoot(container);root.render(<LspConnectionSyncer/>);});await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});
    const oldToken=(mocks.updateConfiguration.mock.calls[0] as any[])[0].oxideAnalysisToken;
    await act(async()=>{mocks.processSnapshot={ready:true,generation:{}};for(const listener of mocks.processListeners)listener();await flushAsyncWork();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});const fresh=useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]?.context?.analysisToken;
    expect(fresh).toBeTruthy();expect(fresh).not.toBe(oldToken);await act(async()=>{finish(true);await flushAsyncWork();});
    expect(useLspSemanticStatusStore.getState().byConnectionId["postgres-1"]?.context?.analysisToken).toBe(fresh);
  });
  it("reopens unchanged project documents after the same client gets a new process",async()=>{
    useProjectStore.setState({projects:[{id:"sqls",name:"sqls",created_at:0,updated_at:0,root_path:"C:/workspace"}]});
    mocks.getLspDocuments.mockResolvedValue([{relativePath:"queries/current.sql",content:"SELECT 1"}] as never);
    await act(async()=>{root=createRoot(container);root.render(<LspConnectionSyncer/>);});await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});const opens=mocks.didOpen.mock.calls.length;expect(opens).toBeGreaterThan(0);
    await act(async()=>{mocks.processSnapshot={ready:true,generation:{}};for(const listener of mocks.processListeners)listener();await flushAsyncWork();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(500);await flushAsyncWork();});expect(mocks.didOpen.mock.calls.length).toBeGreaterThan(opens);expect(mocks.didClose).toHaveBeenCalled();
  });

});
