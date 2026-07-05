import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import {
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools/defaultRegistry";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => []),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  },
  databaseService: {
    getDatabaseCapabilities: vi.fn(async () => ({})),
  },
  queryService: {
    executeQuery: mocks.executeQuery,
  },
  schemaService: {
    getCollections: vi.fn(async () => []),
    getColumns: vi.fn(async () => []),
    getConstraints: vi.fn(async () => []),
    getFunctions: vi.fn(async () => []),
    getIndexes: vi.fn(async () => []),
    getTables: vi.fn(async () => []),
    setCurrentSchema: vi.fn(async () => undefined),
  },
  storeService: {
    getResources: vi.fn(async () => []),
    upsertResources: vi.fn(async () => undefined),
  },
  tableService: {},
}));

describe("workspace AI tools", () => {
  beforeEach(() => {
    mocks.executeQuery.mockClear();
    useConnectionStore.setState({
      connections: [
        {
          id: "elasticsearch-1",
          name: "Elasticsearch",
          driver: "elasticsearch",
          url: "http://localhost:9200",
        },
      ],
      activeConnectionId: "elasticsearch-1",
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useSchemaStore.setState({
      schemas: ["default"],
      currentSchema: "default",
      tables: [],
      collections: [],
      functions: [],
    });
    useTabStore.setState({
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          title: "Index: events-2026",
          type: "query",
          sql: '{"query":{"match_all":{}}}',
          connectionId: "elasticsearch-1",
          schemaName: "default",
          tableName: "events-2026",
          objectType: "index",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      closedTabsStack: [],
    });
  });

  it("passes active search index context to read query execution", async () => {
    const registry = createWorkspaceAiToolRegistry();

    await registry.executeWithPolicy(
      "query.runReadOnly",
      {
        connectionId: "elasticsearch-1",
        query: '{"query":{"match_all":{}}}',
      },
      {
        requestId: "workspace-ai-test",
        activeConnectionId: "elasticsearch-1",
        activeDriver: "elasticsearch",
      },
      DEFAULT_AI_TOOL_POLICY
    );

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "elasticsearch-1",
      '{"query":{"match_all":{}}}',
      "events-2026"
    );
  });

  it("lets explicit tool namespace override active workspace context", async () => {
    const registry = createWorkspaceAiToolRegistry();

    await registry.executeWithPolicy(
      "query.runReadOnly",
      {
        connectionId: "elasticsearch-1",
        namespace: "manual-index",
        query: '{"query":{"match_all":{}}}',
      },
      {
        requestId: "workspace-ai-test",
        activeConnectionId: "elasticsearch-1",
        activeDriver: "elasticsearch",
      },
      DEFAULT_AI_TOOL_POLICY
    );

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "elasticsearch-1",
      '{"query":{"match_all":{}}}',
      "manual-index"
    );
  });

  it("exposes active namespace and object context to assistant planners", () => {
    const context = createWorkspaceAiToolContext("workspace-ai-test");

    expect(context).toMatchObject({
      requestId: "workspace-ai-test",
      activeConnectionId: "elasticsearch-1",
      activeDriver: "elasticsearch",
      activeNamespace: "default",
      activeTab: {
        id: "tab-1",
        schemaName: "default",
        tableName: "events-2026",
        objectType: "index",
      },
    });
  });

  it("plans metadata description for the active object before listing objects", async () => {
    const runtime = createAssistantRuntime({
      registry: createWorkspaceAiToolRegistry(),
      createContext: () => createWorkspaceAiToolContext("workspace-ai-test"),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "describe current index metadata",
    });

    expect(turn.suggestedPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "metadata-active-object",
          toolName: "metadata.describeObject",
          input: {
            name: "events-2026",
            namespace: "default",
          },
        }),
      ])
    );
  });
});
