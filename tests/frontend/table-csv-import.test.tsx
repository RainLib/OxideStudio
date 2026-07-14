/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableDataView } from "@/components/workspace/TableDataView";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  mutateTableRows: vi.fn(async () => ({
    inserted: 1,
    updated: 0,
    deleted: 0,
    rowsAffected: 1,
  })),
  previewTablePage: vi.fn(async () => {
    throw new Error("refresh offline");
  }),
  loadTableMetadata: vi.fn(async () => ({
    columns: [
      {
        name: "email",
        data_type: "text",
        is_nullable: true,
        is_primary_key: false,
        is_unique: false,
        is_indexed: false,
        default_value: null,
        is_auto_increment: false,
        comment: null,
      },
    ],
    indexes: [],
    constraints: [],
    source: "remote" as const,
    updatedAt: Date.now(),
  })),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: vi.fn(async (driver: string) => ({ driver })),
  },
  queryService: {
    executeQuery: vi.fn(async () => []),
  },
  tableService: {
    mutateTableRows: mocks.mutateTableRows,
    previewTablePage: mocks.previewTablePage,
  },
}));

vi.mock("@/services/tableMetadataCache", () => ({
  loadTableMetadata: mocks.loadTableMetadata,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => undefined),
}));

vi.mock("@/components/workspace/DataGrid", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    DataGrid: React.forwardRef(() => <div data-testid="data-grid" />),
  };
});

vi.mock("@/components/workspace/GridFilterRow", () => ({
  GridFilterRow: () => <div data-testid="grid-filter" />,
}));

vi.mock("@/components/workspace/TableDataToolbar", () => ({
  TableDataToolbar: () => <div data-testid="table-toolbar" />,
}));

vi.mock("@/components/workspace/CreateConstraintDialog", () => ({
  CreateConstraintDialog: () => null,
}));

vi.mock("@/components/workspace/CreateIndexDialog", () => ({
  CreateIndexDialog: () => null,
}));

describe("TableDataView CSV import", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.mutateTableRows.mockClear();
    mocks.previewTablePage.mockClear();
    mocks.loadTableMetadata.mockClear();
    useTaskStore.setState({ tasks: [] });
    useConnectionStore.setState({
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
      ],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
      isLoading: false,
      selectedConnection: null,
    });
    useTabStore.setState({
      activeTabId: "tab-1",
      closedTabsStack: [],
      tabs: [
        {
          id: "tab-1",
          title: "users",
          type: "table",
          sql: "",
          connectionId: "postgres-1",
          schemaName: "public",
          tableName: "users",
          tableColumns: [],
          tableIndexes: [],
          results: [
            {
              columns: [{ name: "email", data_type: "text" }],
              rows: [],
            },
          ],
          pendingEdits: new Map(),
          newRowsCount: 0,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("keeps a successful import successful when the follow-up refresh fails", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<TableDataView />);
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const file = {
      name: "users.csv",
      text: vi.fn(async () => "email\ncreated@example.test\n"),
    };
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => expect(mocks.previewTablePage).toHaveBeenCalledOnce());
    });

    expect(mocks.mutateTableRows).toHaveBeenCalledOnce();
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ email: "created@example.test" }]
    );
    const importTask = useTaskStore
      .getState()
      .tasks.find((task) => task.kind === "import");
    expect(importTask?.status).toBe("success");
    expect(importTask?.detail).toContain("1 rows imported");
    expect(importTask?.detail).toContain("refresh failed");
    expect(importTask?.error).toBeNull();

    const tab = useTabStore.getState().tabs[0]!;
    expect(tab.error).toContain("Rows were imported");
    expect(tab.error).toContain("Click Refresh");
    expect(tab.error).toContain("refresh offline");
  });

  it("maps case-insensitive CSV headers to the canonical table column name", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<TableDataView />);
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = {
      name: "users.csv",
      text: vi.fn(async () => "EMAIL\ncreated@example.test\n"),
    };
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => expect(mocks.mutateTableRows).toHaveBeenCalled());
    });

    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ email: "created@example.test" }]
    );
  });
});
