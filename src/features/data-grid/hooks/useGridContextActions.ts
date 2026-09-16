import type { FilterOperator } from "@/components/workspace/GridFilterRow";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import { isTableColumnEditable } from "@/features/data-grid/model/tableColumnEditability";
import type { DataGridHoverTooltipState } from "@/features/data-grid/ui/DataGridHoverTooltip";
import {
  gridCellTooltipText,
  gridHoverTooltipPosition,
} from "@/features/data-grid/ui/DataGridHoverTooltip";
import type { TabState } from "@/features/workspace-tabs/model/types";
import type { DataGridVisualRow } from "@/lib/dataGridRows";
import {
  buildForeignKeyNavigationPlans,
  type ForeignKeyNavigationPlan,
} from "@/lib/foreignKeyNavigation";
import { resultColumnIndexByGridId } from "@/lib/gridColumns";
import { isTableCellExpression } from "@/lib/tableCellExpression";
import type { QueryResult } from "@/services/tauri/types/query";
import type {
  ColumnInfo,
  ConstraintInfo,
  ForeignKeyReferenceInfo,
} from "@/services/tauri/types/schemaCatalog";
import type {
  GridCell,
  GridColumn,
  GridSelection,
  Item,
} from "@glideapps/glide-data-grid";
import {
  CompactSelection,
  type CellClickedEventArgs,
  type GridMouseEventArgs,
  type HeaderClickedEventArgs,
} from "@glideapps/glide-data-grid";

import type { ColumnFilter } from "@/components/workspace/GridFilterRow";
import { useCallback, useMemo } from "react";

interface GridContextActionsOptions {
  gridContainerRef: React.RefObject<HTMLDivElement | null>;
  isTransposed: boolean;
  result: QueryResult | undefined;
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  columns: GridColumn[];
  visualColumnIndexToResultIndex: (visualColumnIndex: number) => number;
  setGridSelection: React.Dispatch<React.SetStateAction<GridSelection>>;
  setContextMenu: React.Dispatch<
    React.SetStateAction<{
      type: "cell" | "header" | null;
      x: number;
      y: number;
      col?: number | undefined;
      row?: number | undefined;
      columnId?: string | undefined;
      columnName?: string | undefined;
    }>
  >;
  setHoverTooltip: React.Dispatch<
    React.SetStateAction<DataGridHoverTooltipState | null>
  >;
  tableColumnsByName: Map<string, ColumnInfo>;
  getCellContent: (cell: Item) => GridCell;
  contextMenu: {
    type: "cell" | "header" | null;
    x: number;
    y: number;
    col?: number | undefined;
    row?: number | undefined;
    columnId?: string | undefined;
    columnName?: string | undefined;
  };
  openValueEditor: (cell: Item) => void;
  formatterKeysForResultColumn: (columnIndex: number) => string[];
  setFormatterTarget: React.Dispatch<
    React.SetStateAction<{
      columnIndex: number;
      columnName: string;
      keys: string[];
      sampleValue: unknown;
    } | null>
  >;
  activeTab: GridTabSnapshot | null;
  setGridSort: TabState["setGridSort"];
  setGridFilter: TabState["setGridFilter"];
  frozenColumnCount: number;
  setFrozenColumnCount: TabState["setFrozenColumnCount"];
  setColumnHidden: TabState["setColumnHidden"];
  showAllColumns: TabState["showAllColumns"];
  selectedRowIndexes: number[];
  deleteRows: TabState["deleteRows"];
  visualRows: DataGridVisualRow[];
  pendingEdits: Map<string, unknown>;
  isEditable: boolean;
  cloneRows: TabState["cloneRows"];
  setFilterMode: TabState["setFilterMode"];
  setVisualFilters: TabState["setVisualFilters"];
  setSqlFilter: TabState["setSqlFilter"];
  loadTablePage: TabState["loadTablePage"];
  setCellEdit: TabState["setCellEdit"];
  tableConstraints: ConstraintInfo[];
  referencingForeignKeys: ForeignKeyReferenceInfo[];
  findOrCreateTableTab: TabState["findOrCreateTableTab"];
}

export function useGridContextActions({
  gridContainerRef,
  isTransposed,
  result,
  overrideColumns,
  columns,
  visualColumnIndexToResultIndex,
  setGridSelection,
  setContextMenu,
  setHoverTooltip,
  tableColumnsByName,
  getCellContent,
  contextMenu,
  openValueEditor,
  formatterKeysForResultColumn,
  setFormatterTarget,
  activeTab,
  setGridSort,
  setGridFilter,
  frozenColumnCount,
  setFrozenColumnCount,
  setColumnHidden,
  showAllColumns,
  selectedRowIndexes,
  deleteRows,
  visualRows,
  pendingEdits,
  isEditable,
  cloneRows,
  setFilterMode,
  setVisualFilters,
  setSqlFilter,
  loadTablePage,
  setCellEdit,
  tableConstraints,
  referencingForeignKeys,
  findOrCreateTableTab,
}: GridContextActionsOptions) {
  const menuPosition = useCallback((localX: number, localY: number) => {
    const rect = gridContainerRef.current?.getBoundingClientRect();
    return {
      x: (rect?.left ?? 0) + localX,
      y: (rect?.top ?? 0) + localY,
    };
  }, []);

  const onCellContextMenu = useCallback(
    (cell: Item, event: CellClickedEventArgs) => {
      if (
        isTransposed ||
        (!result && (!overrideColumns || overrideColumns.length === 0))
      ) {
        return;
      }
      event.preventDefault();
      const [col, row] = cell;
      const position = menuPosition(event.localEventX, event.localEventY);
      const columnId = String(columns[col]?.id || "");
      const originalColumnIndex = visualColumnIndexToResultIndex(col);
      const columnName =
        result?.columns[originalColumnIndex]?.name ||
        overrideColumns?.[originalColumnIndex]?.name ||
        columnId;

      setGridSelection((selection) => ({
        ...selection,
        current: {
          cell,
          range: { x: col, y: row, width: 1, height: 1 },
          rangeStack: [],
        },
      }));
      setContextMenu({
        type: "cell",
        ...position,
        row,
        col,
        columnId,
        columnName,
      });
    },
    [
      columns,
      menuPosition,
      overrideColumns,
      result,
      isTransposed,
      visualColumnIndexToResultIndex,
    ],
  );

  const onItemHovered = useCallback(
    (event: GridMouseEventArgs) => {
      if (event.kind !== "cell" && event.kind !== "header") {
        setHoverTooltip(null);
        return;
      }

      const [col, row] = event.location;
      const visualColumn = columns[col];
      if (!visualColumn) {
        setHoverTooltip(null);
        return;
      }

      const originalColumnIndex = visualColumnIndexToResultIndex(col);
      const column =
        result?.columns[originalColumnIndex] ??
        overrideColumns?.[originalColumnIndex];
      const metadata = column ? tableColumnsByName.get(column.name) : undefined;
      const content =
        event.kind === "cell"
          ? gridCellTooltipText(getCellContent([col, row]))
          : "";
      setHoverTooltip({
        key: `${event.kind}:${col}:${row}:${content}`,
        ...gridHoverTooltipPosition(event),
        columnName: column?.name ?? String(visualColumn.id),
        columnType: column
          ? "data_type" in column
            ? column.data_type
            : column.type
          : "",
        columnComment: metadata?.comment?.trim() || undefined,
        content,
      });
    },
    [
      columns,
      getCellContent,
      overrideColumns,
      result,
      tableColumnsByName,
      visualColumnIndexToResultIndex,
    ],
  );

  const onHeaderContextMenu = useCallback(
    (col: number, event: HeaderClickedEventArgs) => {
      if (!result || isTransposed) return;
      event.preventDefault();
      const position = menuPosition(event.localEventX, event.localEventY);
      const columnId = String(columns[col]?.id || "");
      const originalColumnIndex = resultColumnIndexByGridId(
        result.columns,
        columnId,
      );
      setContextMenu({
        type: "header",
        ...position,
        col,
        columnId,
        columnName: result.columns[originalColumnIndex]?.name || columnId,
      });
    },
    [columns, menuPosition, result, isTransposed],
  );

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu({ type: null, x: 0, y: 0 });
  }, []);

  const handleOpenValueEditor = useCallback(() => {
    if (contextMenu.col === undefined || contextMenu.row === undefined) return;
    openValueEditor([contextMenu.col, contextMenu.row]);
    closeContextMenu();
  }, [closeContextMenu, contextMenu.col, contextMenu.row, openValueEditor]);

  // Context menu action handlers
  const handleCopyColumnName = useCallback(() => {
    if (contextMenu.columnName) {
      void navigator.clipboard.writeText(contextMenu.columnName);
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleOpenColumnFormatter = useCallback(() => {
    if (contextMenu.col === undefined || !result) return;
    const columnIndex = visualColumnIndexToResultIndex(contextMenu.col);
    const column = result.columns[columnIndex];
    const keys = formatterKeysForResultColumn(columnIndex);
    if (!column || keys.length === 0) return;
    setFormatterTarget({
      columnIndex,
      columnName: column.name,
      keys,
      sampleValue: result.rows[0]?.[columnIndex],
    });
    closeContextMenu();
  }, [
    closeContextMenu,
    contextMenu.col,
    formatterKeysForResultColumn,
    result,
    visualColumnIndexToResultIndex,
  ]);

  const handleSortAsc = useCallback(() => {
    if (!activeTab || !contextMenu.columnId) return;
    if (contextMenu.columnId) {
      setGridSort(activeTab.id, contextMenu.columnId, "asc");
    }
    closeContextMenu();
  }, [activeTab, contextMenu.columnId, setGridSort, closeContextMenu]);

  const handleSortDesc = useCallback(() => {
    if (!activeTab || !contextMenu.columnId) return;
    if (contextMenu.columnId) {
      setGridSort(activeTab.id, contextMenu.columnId, "desc");
    }
    closeContextMenu();
  }, [activeTab, contextMenu.columnId, setGridSort, closeContextMenu]);

  const handleClearSort = useCallback(() => {
    if (activeTab) setGridSort(activeTab.id, null, null);
    closeContextMenu();
  }, [activeTab, closeContextMenu, setGridSort]);

  const handleOpenColumnFilter = useCallback(() => {
    if (!activeTab || !contextMenu.columnId) return;

    const currentValue =
      activeTab.gridState?.columnFilters?.[contextMenu.columnId]?.value || "";
    const nextValue = window.prompt(
      `Filter "${contextMenu.columnName}" contains:`,
      currentValue,
    );

    if (nextValue === null) {
      closeContextMenu();
      return;
    }

    const value = nextValue.trim();
    setGridFilter(
      activeTab.id,
      contextMenu.columnId,
      value ? { operator: "contains", value } : undefined,
    );
    closeContextMenu();
  }, [
    activeTab,
    contextMenu.columnId,
    contextMenu.columnName,
    setGridFilter,
    closeContextMenu,
  ]);

  const handleHideColumn = useCallback(() => {
    if (!activeTab || !contextMenu.columnId || columns.length <= 1) return;
    if (contextMenu.col !== undefined && contextMenu.col < frozenColumnCount) {
      setFrozenColumnCount(activeTab.id, frozenColumnCount - 1);
    }
    setColumnHidden(activeTab.id, contextMenu.columnId, true);
    closeContextMenu();
  }, [
    activeTab,
    closeContextMenu,
    columns.length,
    contextMenu.col,
    contextMenu.columnId,
    frozenColumnCount,
    setColumnHidden,
    setFrozenColumnCount,
  ]);

  const handleShowAllColumns = useCallback(() => {
    if (!activeTab) return;
    showAllColumns(activeTab.id);
    closeContextMenu();
  }, [activeTab, closeContextMenu, showAllColumns]);

  const handleFreezeThroughColumn = useCallback(() => {
    if (!activeTab || contextMenu.col === undefined) return;
    setFrozenColumnCount(activeTab.id, contextMenu.col + 1);
    closeContextMenu();
  }, [activeTab, closeContextMenu, contextMenu.col, setFrozenColumnCount]);

  const handleUnfreezeColumns = useCallback(() => {
    if (!activeTab) return;
    setFrozenColumnCount(activeTab.id, 0);
    closeContextMenu();
  }, [activeTab, closeContextMenu, setFrozenColumnCount]);

  const handleDeleteSelectedRows = useCallback(async () => {
    if (!activeTab || selectedRowIndexes.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedRowIndexes.length} selected row${
        selectedRowIndexes.length === 1 ? "" : "s"
      }?`,
    );
    if (!confirmed) return;

    await deleteRows(activeTab.id, selectedRowIndexes);
    setGridSelection({
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
    });
  }, [activeTab, deleteRows, selectedRowIndexes]);

  const contextCellValue = useMemo(() => {
    if (
      !result ||
      contextMenu.col === undefined ||
      contextMenu.row === undefined
    ) {
      return undefined;
    }
    const columnIndex = visualColumnIndexToResultIndex(contextMenu.col);
    const visualRow = visualRows[contextMenu.row];
    if (columnIndex < 0 || !visualRow) return undefined;
    const { rowKey: rowIndex } = visualRow;

    const editKey = `${rowIndex}:${columnIndex}`;
    const value = pendingEdits.has(editKey)
      ? pendingEdits.get(editKey)
      : rowIndex >= 0
        ? result.rows[rowIndex]?.[columnIndex]
        : undefined;
    // A staged expression is not the cell's current database value, so a
    // context-menu filter must wait for the reviewed mutation to commit.
    return isTableCellExpression(value) ? undefined : value;
  }, [
    contextMenu.col,
    contextMenu.row,
    pendingEdits,
    result,
    visualColumnIndexToResultIndex,
    visualRows,
  ]);

  const contextSourceRowIndex = useMemo(() => {
    if (contextMenu.row === undefined || contextMenu.row < 0) {
      return undefined;
    }
    const rowKey = visualRows[contextMenu.row]?.rowKey;
    return rowKey !== undefined && rowKey >= 0 ? rowKey : undefined;
  }, [contextMenu.row, visualRows]);

  const handleCloneRows = useCallback(() => {
    if (!activeTab || contextSourceRowIndex === undefined || !isEditable)
      return;
    const sourceRows = selectedRowIndexes.includes(contextSourceRowIndex)
      ? selectedRowIndexes
      : [contextSourceRowIndex];
    cloneRows(activeTab.id, sourceRows);
    closeContextMenu();
  }, [
    activeTab,
    cloneRows,
    closeContextMenu,
    contextSourceRowIndex,
    isEditable,
    selectedRowIndexes,
  ]);

  const handleLocalCellFilter = useCallback(
    (
      operator:
        | "equals"
        | "notEquals"
        | "contains"
        | "notContains"
        | "isNull"
        | "isNotNull",
    ) => {
      if (!activeTab || !contextMenu.columnId) return;
      setGridFilter(activeTab.id, contextMenu.columnId, {
        operator,
        value:
          operator === "isNull" || operator === "isNotNull"
            ? "__presence__"
            : String(contextCellValue ?? ""),
      });
      closeContextMenu();
    },
    [
      activeTab,
      closeContextMenu,
      contextCellValue,
      contextMenu.columnId,
      setGridFilter,
    ],
  );

  const handleDatabaseCellFilter = useCallback(
    async (operator: FilterOperator) => {
      if (
        activeTab?.type !== "table" ||
        !contextMenu.columnId ||
        contextCellValue === null ||
        contextCellValue === undefined
      ) {
        return;
      }
      const nextFilter: ColumnFilter = {
        column: contextMenu.columnId,
        operator,
        value: String(contextCellValue),
        logic: "AND",
      };
      const existingFilters = (activeTab.visualFilters || []).filter(
        (filter) => filter.column && filter.value.trim(),
      );
      const nextFilters = [...existingFilters, nextFilter];
      setFilterMode(activeTab.id, "visual");
      setVisualFilters(activeTab.id, nextFilters);
      setSqlFilter(activeTab.id, "");
      closeContextMenu();
      await loadTablePage(activeTab.id, 0, null, nextFilters, {
        discardAction: "filter the table by this value",
      });
    },
    [
      activeTab,
      closeContextMenu,
      contextCellValue,
      contextMenu.columnId,
      loadTablePage,
      setFilterMode,
      setSqlFilter,
      setVisualFilters,
    ],
  );

  const handleClearLocalColumnFilter = useCallback(() => {
    if (!activeTab || !contextMenu.columnId) return;
    setGridFilter(activeTab.id, contextMenu.columnId, undefined);
    closeContextMenu();
  }, [activeTab, closeContextMenu, contextMenu.columnId, setGridFilter]);

  const contextValueLabel = useMemo(() => {
    if (contextCellValue === null) return "NULL";
    const value = String(contextCellValue ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!value) return "empty value";
    return value.length > 28 ? `${value.slice(0, 27)}…` : value;
  }, [contextCellValue]);

  const handleSetCellNull = useCallback(() => {
    if (
      !activeTab ||
      !isEditable ||
      contextMenu.col === undefined ||
      contextMenu.row === undefined
    ) {
      return;
    }

    const colIndex = visualColumnIndexToResultIndex(contextMenu.col);
    const rowIndex = visualRows[contextMenu.row]?.rowKey;
    if (colIndex < 0 || rowIndex === undefined) return;
    const columnName =
      result?.columns[colIndex]?.name || overrideColumns?.[colIndex]?.name;
    const metadata = tableColumnsByName.get(columnName || "");
    if (!isTableColumnEditable(metadata)) return;

    setCellEdit(activeTab.id, rowIndex, colIndex, null);
    closeContextMenu();
  }, [
    activeTab,
    closeContextMenu,
    contextMenu.col,
    contextMenu.row,
    isEditable,
    overrideColumns,
    result,
    setCellEdit,
    visualRows,
    tableColumnsByName,
    visualColumnIndexToResultIndex,
  ]);

  const contextColumnAllowsNull = useMemo(() => {
    if (!contextMenu.columnName) return false;
    const column = tableColumnsByName.get(contextMenu.columnName);
    return column?.is_nullable !== false && isTableColumnEditable(column);
  }, [contextMenu.columnName, tableColumnsByName]);

  const contextForeignKeyPlans = useMemo(() => {
    if (
      activeTab?.type !== "table" ||
      !activeTab.schemaName ||
      !activeTab.tableName ||
      !result ||
      !contextMenu.columnName ||
      contextMenu.row === undefined
    ) {
      return [];
    }

    const resultRowIndex = visualRows[contextMenu.row]?.rowKey;
    if (resultRowIndex === undefined || resultRowIndex < 0) return [];
    const resultRow = result.rows[resultRowIndex];
    if (!resultRow) return [];

    const rowWithDrafts = resultRow.map(
      (value: unknown, columnIndex: number) => {
        const key = `${resultRowIndex}:${columnIndex}`;
        const pendingValue = pendingEdits.has(key)
          ? pendingEdits.get(key)
          : value;
        // Foreign-key navigation must use a known row identity, never an
        // expression whose resulting value is not available until commit.
        return isTableCellExpression(pendingValue) ? value : pendingValue;
      },
    );

    return buildForeignKeyNavigationPlans({
      currentSchema: activeTab.schemaName,
      currentTable: activeTab.tableName,
      selectedColumn: contextMenu.columnName,
      columns: result.columns.map((column) => column.name),
      row: rowWithDrafts,
      constraints: tableConstraints,
      referencingForeignKeys,
    });
  }, [
    activeTab?.schemaName,
    activeTab?.tableName,
    activeTab?.type,
    contextMenu.columnName,
    contextMenu.row,
    pendingEdits,
    referencingForeignKeys,
    result,
    visualRows,
    tableConstraints,
  ]);

  const handleForeignKeyNavigation = useCallback(
    async (plan: ForeignKeyNavigationPlan) => {
      if (activeTab?.type !== "table" || !activeTab.connectionId) return;

      const targetTabId = findOrCreateTableTab(
        activeTab.connectionId,
        plan.schema,
        plan.table,
        "table",
        activeTab.databaseName,
      );
      setFilterMode(targetTabId, "visual");
      setVisualFilters(targetTabId, plan.filters);
      setSqlFilter(targetTabId, "");
      await loadTablePage(targetTabId, 0, null, plan.filters, {
        discardAction:
          plan.direction === "referenced"
            ? "open the referenced row"
            : "show referencing rows",
      });
    },
    [
      activeTab,
      findOrCreateTableTab,
      loadTablePage,
      setFilterMode,
      setSqlFilter,
      setVisualFilters,
    ],
  );

  return {
    handleDeleteSelectedRows,
    handleCopyColumnName,
    handleOpenColumnFormatter,
    handleSortAsc,
    handleSortDesc,
    handleClearSort,
    handleOpenColumnFilter,
    handleHideColumn,
    handleShowAllColumns,
    handleFreezeThroughColumn,
    handleUnfreezeColumns,
    handleOpenValueEditor,
    contextValueLabel,
    handleLocalCellFilter,
    contextCellValue,
    handleClearLocalColumnFilter,
    handleDatabaseCellFilter,
    contextForeignKeyPlans,
    handleForeignKeyNavigation,
    contextSourceRowIndex,
    closeContextMenu,
    handleCloneRows,
    contextColumnAllowsNull,
    handleSetCellNull,
    onHeaderContextMenu,
    onCellContextMenu,
    onItemHovered,
  };
}
