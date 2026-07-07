/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSidebar } from "@/components/workspace/AssistantSidebar";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(async () => [
    {
      columns: [{ name: "id", data_type: "integer" }],
      rows: [[1]],
      statementType: "SELECT",
    },
  ]),
  getDatabaseCapabilities: vi.fn(async (driver: string) =>
    defaultDatabaseCapabilities(driver)
  ),
  getCollections: vi.fn(async () => []),
  getColumns: vi.fn(async () => []),
  getConstraints: vi.fn(async () => []),
  getFunctions: vi.fn(async () => []),
  getIndexes: vi.fn(async () => []),
  getTables: vi.fn(async () => []),
  mutateTableRows: vi.fn(async () => ({
    inserted: 0,
    updated: 0,
    deleted: 0,
    rowsAffected: 0,
  })),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
  },
  queryService: {
    executeQuery: mocks.executeQuery,
  },
  schemaService: {
    getCollections: mocks.getCollections,
    getColumns: mocks.getColumns,
    getConstraints: mocks.getConstraints,
    getFunctions: mocks.getFunctions,
    getIndexes: mocks.getIndexes,
    getTables: mocks.getTables,
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
  },
}));

const initialAiSettings = useAiSettingsStore.getState();
const initialConnectionState = useConnectionStore.getState();
const initialSchemaState = useSchemaStore.getState();
const initialTabState = useTabStore.getState();

function buttonWithText(container: ParentNode, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text)
  );
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe("AssistantSidebar", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    useAiSettingsStore.setState(
      {
        ...initialAiSettings,
        enabled: false,
        baseUrl: "",
        model: "",
        apiKey: "",
      },
      true
    );
    useConnectionStore.setState({
      ...initialConnectionState,
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
      ],
      activeConnectionId: "postgres-1",
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useSchemaStore.setState({
      ...initialSchemaState,
      schemas: ["public"],
      currentSchema: "public",
      tables: [],
      collections: [],
      functions: [],
    });
    useTabStore.setState({
      ...initialTabState,
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "SELECT * FROM users",
          connectionId: "postgres-1",
          schemaName: "public",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      activeTabId: "query-1",
      closedTabsStack: [],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    useAiSettingsStore.setState(initialAiSettings, true);
    useConnectionStore.setState(initialConnectionState, true);
    useSchemaStore.setState(initialSchemaState, true);
    useTabStore.setState(initialTabState, true);
  });

  it("plans and runs safe workspace registry tools from the in-app assistant", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<AssistantSidebar />);
      await flushAsyncWork();
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeTruthy();

    await act(async () => {
      setTextareaValue(textarea!, "run current query");
      await flushAsyncWork();
    });

    await act(async () => {
      buttonWithText(container, "Plan")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("query.runReadOnly");

    await act(async () => {
      buttonWithText(container, "Run Safe")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(mocks.executeQuery).toHaveBeenCalledWith(
      "postgres-1",
      "SELECT * FROM users",
      "public"
    );
    expect(container.textContent).toContain("tool calls succeeded");
  });
});
