/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableDataView } from "@/components/workspace/TableDataView";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  exportTableData: vi.fn(),
  mutateTableRows: vi.fn(),
  getDatabaseReferencingForeignKeys: vi.fn(async () => []),
  loadTableMetadata: vi.fn(async () => ({
    columns: [
      {
        name: "id",
        data_type: "int4",
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
      },
    ],
    indexes: [],
    constraints: [],
    ddl: null,
    viewDefinition: null,
    source: "remote" as const,
    updatedAt: 1,
  })),
  loadTableDdl: vi.fn(async () => "CREATE TABLE public.users (id int4 PRIMARY KEY);"),
  toolbarProps: null as Record<string, unknown> | null,
  gridProps: null as Record<string, unknown> | null,
  ddlProps: null as Record<string, unknown> | null,
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: vi.fn(async () => ({
      driver: "postgres",
      dataModel: "relational",
      supportsTableIndexes: true,
      supportsTableConstraints: true,
      supportsForeignKeys: true,
    })),
  },
  queryService: {
    executeQuery: vi.fn(async () => []),
  },
  tableService: {
    exportTableData: mocks.exportTableData,
    mutateTableRows: mocks.mutateTableRows,
  },
  schemaService: {
    getDatabaseReferencingForeignKeys: mocks.getDatabaseReferencingForeignKeys,
    getReferencingForeignKeys: vi.fn(async () => []),
  },
}));

vi.mock("@/services/tableMetadataCache", () => ({
  loadTableMetadata: mocks.loadTableMetadata,
  loadTableDdl: mocks.loadTableDdl,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => undefined),
}));

vi.mock("@/components/workspace/DataGrid", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    DataGrid: React.forwardRef((props: Record<string, unknown>, _ref) => {
      mocks.gridProps = props;
      return <div data-testid="data-grid" />;
    }),
  };
});

vi.mock("@/components/workspace/GridFilterRow", () => ({
  GridFilterRow: () => <div data-testid="grid-filter" />,
}));

vi.mock("@/components/workspace/TableDataToolbar", () => ({
  TableDataToolbar: (props: Record<string, unknown>) => {
    mocks.toolbarProps = props;
    return <div data-testid="table-toolbar" />;
  },
}));

vi.mock("@/components/workspace/TableDdlView", () => ({
  TableDdlView: (props: Record<string, unknown>) => {
    mocks.ddlProps = props;
    return <div data-testid="table-ddl">{String(props.ddl || "")}</div>;
  },
}));

vi.mock("@/components/workspace/CreateConstraintDialog", () => ({
  CreateConstraintDialog: () => null,
}));

vi.mock("@/components/workspace/CreateIndexDialog", () => ({
  CreateIndexDialog: () => null,
}));

describe("cross-database table data view", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toolbarProps = null;
    mocks.gridProps = null;
    mocks.ddlProps = null;
    useProjectStore.setState({ activeProjectId: "project-analytics" });
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
      activeTabId: "analytics-users",
      closedTabsStack: [],
      tabs: [
        {
          id: "analytics-users",
          title: "users",
          type: "table",
          sql: "",
          connectionId: "postgres-1",
          databaseName: "analytics",
          schemaName: "public",
          tableName: "users",
          objectType: "BASE TABLE",
          results: [
            {
              columns: [{ name: "id", data_type: "int4" }],
              rows: [[1]],
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

  it("binds metadata and row edits to the selected PostgreSQL database", async () => {
    mocks.getDatabaseReferencingForeignKeys.mockResolvedValueOnce([
      {
        name: "audit_user_fk",
        schema: "audit",
        table: "events",
        columns: ["user_id"],
        referenced_schema: "public",
        referenced_table: "users",
        referenced_columns: ["id"],
      },
    ]);
    await act(async () => {
      root = createRoot(container);
      root.render(<TableDataView />);
    });
    await vi.waitFor(() => expect(mocks.loadTableMetadata).toHaveBeenCalled());

    expect(mocks.loadTableMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-analytics",
        connectionId: "postgres-1",
        databaseName: "analytics",
        schema: "public",
        table: "users",
      })
    );
    expect(mocks.getDatabaseReferencingForeignKeys).toHaveBeenCalledWith(
      "postgres-1",
      "analytics",
      "public",
      "users"
    );
    await vi.waitFor(() => {
      expect(mocks.gridProps?.referencingForeignKeys).toEqual([
        expect.objectContaining({ table: "events", columns: ["user_id"] }),
      ]);
    });
    expect(mocks.toolbarProps).toMatchObject({
      readOnly: false,
      exportDisabled: true,
      editingEnabled: true,
    });
    expect(mocks.gridProps).toMatchObject({ readOnly: false });
    expect(container.textContent).toContain("analytics.public.users");

    await act(async () => {
      (mocks.toolbarProps?.onExportCsv as (() => void) | undefined)?.();
      await Promise.resolve();
    });
    expect(mocks.exportTableData).not.toHaveBeenCalled();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = {
      name: "users.csv",
      text: vi.fn(async () => "id\n2\n"),
    };
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.mutateTableRows).not.toHaveBeenCalled();

    let importButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      importButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Import 1 row");
      expect(importButton).toBeDefined();
      expect(importButton?.disabled).toBe(false);
    });
    await act(async () => {
      importButton!.click();
    });

    await vi.waitFor(() => expect(mocks.mutateTableRows).toHaveBeenCalled());
    expect(file.text).toHaveBeenCalled();
    expect(mocks.mutateTableRows).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      "public",
      "users",
      [{ id: "2" }],
      [],
      [],
      "analytics"
    );
  });

  it("does not expose the redundant structure property panel", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<TableDataView />);
    });
    await vi.waitFor(() => expect(mocks.loadTableMetadata).toHaveBeenCalled());

    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent?.trim() === "Structure"
      )
    ).toBe(false);
  });

  it("loads the DDL view from the selected PostgreSQL database", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<TableDataView />);
    });

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "DDL")
        ?.click();
    });
    await vi.waitFor(() => expect(mocks.loadTableDdl).toHaveBeenCalled());

    expect(mocks.loadTableDdl).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-analytics",
        connectionId: "postgres-1",
        databaseName: "analytics",
        schema: "public",
        table: "users",
      }),
      "BASE TABLE",
      false
    );
    expect(mocks.ddlProps?.ddl).toContain("CREATE TABLE");
  });
});
