import {
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  DataEditor,
  GridCell,
  GridColumn,
  Item,
  Theme,
  GridCellKind,
  GridColumnIcon,
  EditableGridCell,
  GridSelection,
  CompactSelection,
  type CellClickedEventArgs,
  type DataEditorRef,
  type EditListItem,
  type GridKeyEventArgs,
  type GridMouseEventArgs,
  type HeaderClickedEventArgs,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useTabStore } from "@/store/useTabStore";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTheme } from "@/theme/useTheme";
import { createTypedCell, applyFilter } from "@/lib/gridUtils";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Pin,
  PinOff,
  RotateCcw,
  Rows3,
  Search,
  Sparkles,
  CircleSlash2,
  CircleAlert,
  ChevronDown,
  FileCode2,
  FileSpreadsheet,
  SquarePen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColumnFilter, FilterOperator } from "./GridFilterRow";
import {
  exportQueryResult,
  serializeQueryResultSelectionToTsv,
  type QueryResultExportFormat,
} from "@/lib/exportUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dataGridMetrics } from "@/lib/dataGridView";
import { resolveToolbarOverflowState } from "@/lib/toolbarOverflow";
import { DataGridBusyIndicator } from "./DataGridBusyIndicator";
import {
  resultColumnGridId,
  resultColumnIndexByGridId,
} from "@/lib/gridColumns";
import {
  compactResultColumnType,
  DataGridContextMenu,
  DataGridHoverTooltip,
  gridHoverTooltipPosition,
  gridCellTooltipText,
  isTableColumnEditable,
  resolveHeaderColumnType,
  resolveRenderedColumnType,
  resultColumnTypeFamily,
  sortDataGridRowIndexes,
  tableColumnEditability,
  tableColumnReadOnlyReason,
  transposeQueryResult,
  filterDataGridColumnLookupItems,
  dataGridCellUsesFullValueEditor,
  adjacentDataGridDetailIndex,
  normalizeDataGridNumericInput,
  gridLayoutKey,
  loadGridLayout,
  normalizeGridLayout,
  planExpandableNewRowPaste,
  type DataGridContextMenuItem,
  type DataGridHoverTooltipState,
  type DataGridColumnLookupItem,
  type DataGridDetailNavigationAxis,
  type DataGridDetailNavigationDelta,
} from "@/features/data-grid";
import { ValueEditorDialog, type ValueEditorTarget } from "./ValueEditorDialog";
import { isTableCellExpression } from "@/lib/tableCellExpression";
import type {
  ConstraintInfo,
  ForeignKeyReferenceInfo,
  QueryResult,
} from "@/services/tauri/types";
import {
  buildForeignKeyNavigationPlans,
  foreignKeyNavigationLabel,
  type ForeignKeyNavigationPlan,
} from "@/lib/foreignKeyNavigation";
import {
  collectSelectionCoordinates,
  summarizeSelection,
} from "@/lib/selectionAggregate";
import { SelectionAggregateBar } from "./SelectionAggregateBar";
import { presentQueryError } from "@/lib/queryErrorPresentation";
import { buildDataGridVisualRows } from "@/lib/dataGridRows";
import {
  APP_EVENT_OPEN_ASSISTANT,
  useAssistantComposerStore,
} from "@/store/useAssistantComposerStore";

interface GridValueEditorTarget extends ValueEditorTarget {
  tabId: string;
  rowIndex: number;
  columnIndex: number;
}

const EMPTY_PENDING_EDITS = new Map<string, unknown>();

export interface DataGridHandle {
  openSearch: () => void;
  openColumnLookup: () => boolean;
  fitColumns: () => void;
  deleteSelectedRows: () => Promise<void>;
  /** Source result indexes, after translating the current visual sort/filter. */
  getSelectedRowIndexes: () => number[];
}

export interface DataGridSelectionSummary {
  selectedRowCount: number;
}

interface DataGridProps {
  globalFilter?: string;
  columnFilters?: ColumnFilter[];
  overrideColumns?: Array<{ name: string; type?: string }>;
  readOnly?: boolean;
  zoomPercent?: number;
  onSelectionSummaryChange?: (summary: DataGridSelectionSummary) => void;
  tableConstraints?: ConstraintInfo[];
  referencingForeignKeys?: ForeignKeyReferenceInfo[];
  /** Alternate presentation data. It is always inspected read-only. */
  resultOverride?: QueryResult;
  transposed?: boolean;
  /** Reviewed native-document actions receive the authoritative source row. */
  onEditDocument?: (sourceRowIndex: number) => void;
  onCloneDocument?: (sourceRowIndex: number) => void;
  onDeleteDocument?: (sourceRowIndex: number) => void;
}

function rangeIndexes(start: number, length: number) {
  return Array.from({ length }, (_, index) => start + index);
}

function exportFilename(
  title: string | undefined,
  extension: "csv" | "json" | "jsonl" | "md" | "tsv" | "sql",
) {
  const safeTitle = (title || "query-result")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeTitle || "query-result"}.${extension}`;
}

function columnIconForType(type: string, isPrimaryKey?: boolean) {
  if (isPrimaryKey) return GridColumnIcon.HeaderRowID;

  switch (resultColumnTypeFamily(type)) {
    case "number":
      return GridColumnIcon.HeaderNumber;
    case "boolean":
      return GridColumnIcon.HeaderBoolean;
    case "date":
    case "datetime":
      return GridColumnIcon.HeaderDate;
    case "time":
      return GridColumnIcon.HeaderTime;
    case "json":
    case "binary":
      return GridColumnIcon.HeaderCode;
    case "array":
      return GridColumnIcon.HeaderArray;
    case "reference":
      return GridColumnIcon.HeaderReference;
    default:
      return GridColumnIcon.HeaderString;
  }
}

function cssHslVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value ? `hsl(${value})` : fallback;
}

function cssHslVarAlpha(name: string, alpha: number, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value ? `hsl(${value} / ${alpha})` : fallback;
}

export const DataGrid = forwardRef<DataGridHandle, DataGridProps>(
  function DataGrid(
    {
      globalFilter = "",
      columnFilters = [],
      overrideColumns,
      readOnly = false,
      zoomPercent,
      onSelectionSummaryChange,
      tableConstraints = [],
      referencingForeignKeys = [],
      resultOverride,
      transposed = false,
      onEditDocument,
      onCloneDocument,
      onDeleteDocument,
    },
    ref,
  ) {
    const activeTabId = useTabStore((state) => state.activeTabId);
    const activeTab = useTabStore(
      useShallow((state) => {
        const tab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
        return tab
          ? {
              id: tab.id,
              title: tab.title,
              type: tab.type,
              connectionId: tab.connectionId,
              databaseName: tab.databaseName,
              schemaName: tab.schemaName,
              tableName: tab.tableName,
              queryLanguage: tab.queryLanguage,
              results: tab.results,
              resultSql: tab.resultSql,
              activeResultIndex: tab.activeResultIndex,
              error: tab.error,
              queryError: tab.queryError,
              isExecuting: tab.isExecuting,
              gridState: tab.gridState,
              pendingEdits: tab.pendingEdits,
              newRowsCount: tab.newRowsCount,
              newRowPlacements: tab.newRowPlacements,
              visualFilters: tab.visualFilters,
              columnWidths: tab.columnWidths,
              columnOrder: tab.columnOrder,
              hiddenColumns: tab.hiddenColumns,
              frozenColumnCount: tab.frozenColumnCount,
              tableColumns: tab.tableColumns,
              tablePage: tab.tablePage,
              tablePageSize: tab.tablePageSize,
            }
          : null;
      }),
    );
    const {
      setGridFilter,
      setGridSort,
      setCellEdit,
      setBulkCellEdit,
      applyNewRowPaste,
      setColumnWidth,
      setColumnOrder,
      setColumnHidden,
      setFrozenColumnCount,
      restoreColumnLayout,
      showAllColumns,
      deleteRows,
      runTabQuery,
      findOrCreateTableTab,
      loadTablePage,
      setFilterMode,
      setVisualFilters,
      setSqlFilter,
      cloneRows,
    } = useTabStore(
      useShallow((state) => ({
        setGridFilter: state.setGridFilter,
        setGridSort: state.setGridSort,
        setCellEdit: state.setCellEdit,
        setBulkCellEdit: state.setBulkCellEdit,
        applyNewRowPaste: state.applyNewRowPaste,
        setColumnWidth: state.setColumnWidth,
        setColumnOrder: state.setColumnOrder,
        setColumnHidden: state.setColumnHidden,
        setFrozenColumnCount: state.setFrozenColumnCount,
        restoreColumnLayout: state.restoreColumnLayout,
        showAllColumns: state.showAllColumns,
        deleteRows: state.deleteRows,
        runTabQuery: state.runTabQuery,
        findOrCreateTableTab: state.findOrCreateTableTab,
        loadTablePage: state.loadTablePage,
        setFilterMode: state.setFilterMode,
        setVisualFilters: state.setVisualFilters,
        setSqlFilter: state.setSqlFilter,
        cloneRows: state.cloneRows,
      })),
    );
    const connections = useConnectionStore((state) => state.connections);
    const dataGridSettings = useSettingsStore(
      (state) => state.settings.dataGrid,
    );
    const copyIncludeHeaders = dataGridSettings.copyIncludeHeaders;
    const showTypeIcons = dataGridSettings.showTypeIcons;
    const viewMetrics = dataGridMetrics(
      dataGridSettings.fontSize,
      dataGridSettings.rowHeight,
      zoomPercent ?? dataGridSettings.zoomPercent,
    );
    const gridScale = viewMetrics.scale;
    const queueQueryErrorFix = useAssistantComposerStore(
      (state) => state.queueQueryErrorFix,
    );

    const resultIndex = activeTab?.activeResultIndex ?? 0;
    const sourceResult =
      activeTab?.results?.[resultIndex] ?? activeTab?.results?.[0];
    const [queryResultTransposed, setQueryResultTransposed] = useState(false);
    const isTransposed = transposed || queryResultTransposed;
    const result =
      resultOverride ??
      (isTransposed && sourceResult
        ? transposeQueryResult(sourceResult)
        : sourceResult);
    const error = activeTab?.error;
    const activeConnection = connections.find(
      (connection) => connection.id === activeTab?.connectionId,
    );
    const errorPresentation = useMemo(
      () =>
        error
          ? presentQueryError(
              error,
              activeConnection?.name,
              activeTab?.queryError,
            )
          : null,
      [activeTab?.queryError, activeConnection?.name, error],
    );
    const gridState = activeTab?.gridState;
    const pendingEdits = activeTab?.pendingEdits || EMPTY_PENDING_EDITS;
    const isEditable = activeTab?.type === "table" && !readOnly && !isTransposed;
    const columnWidths = activeTab?.columnWidths || {};
    const columnOrder = activeTab?.columnOrder || [];
    const hiddenColumns = activeTab?.hiddenColumns || [];
    const frozenColumnCount = isTransposed
      ? Math.min(1, Math.max(0, (result?.columns.length || 0) - 1))
      : Math.min(
          activeTab?.frozenColumnCount || 0,
          Math.max(0, (result?.columns.length || overrideColumns?.length || 0) - 1),
        );
    const newRowsCount = activeTab?.newRowsCount || 0;

    // Row selection state
    const [gridSelection, setGridSelection] = useState<GridSelection>({
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty(),
    });
    const gridSelectionContext = useMemo(
      () => ({ activeTabId, resultIndex, selection: gridSelection }),
      [activeTabId, gridSelection, resultIndex],
    );
    const deferredGridSelectionContext = useDeferredValue(gridSelectionContext);
    const [showSearch, setShowSearch] = useState(false);
    const [columnLookupOpen, setColumnLookupOpen] = useState(false);
    const [columnLookupQuery, setColumnLookupQuery] = useState("");
    const [columnLookupSelectedIndex, setColumnLookupSelectedIndex] = useState(0);
    const [valueEditorTarget, setValueEditorTarget] =
      useState<GridValueEditorTarget | null>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{
      type: "cell" | "header" | null;
      x: number;
      y: number;
      col?: number;
      row?: number;
      columnId?: string;
      columnName?: string;
    }>({ type: null, x: 0, y: 0 });
    const [hoverTooltip, setHoverTooltip] =
      useState<DataGridHoverTooltipState | null>(null);

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const queryToolbarRef = useRef<HTMLDivElement>(null);
    const queryToolbarExpandedWidthRef = useRef(0);
    const dataEditorRef = useRef<DataEditorRef>(null);
    const columnLookupInputRef = useRef<HTMLInputElement>(null);
    const restoredLayoutRef = useRef<string | null>(null);
    const [queryToolbarCompact, setQueryToolbarCompact] = useState(false);
    const queryToolbarVisible = activeTab?.type !== "table" && Boolean(result);
    const queryToolbarStructureKey = [
      queryToolbarVisible,
      Boolean(result?.truncated),
      isTransposed,
    ].join(":");

    useEffect(() => {
      const toolbar = queryToolbarRef.current;
      if (!toolbar || !queryToolbarVisible) return;
      queryToolbarExpandedWidthRef.current = 0;
      setQueryToolbarCompact(false);

      const measure = () => {
        setQueryToolbarCompact((compact) => {
          const next = resolveToolbarOverflowState(
            {
              compact,
              expandedRequiredWidth: queryToolbarExpandedWidthRef.current,
            },
            toolbar.clientWidth,
            toolbar.scrollWidth,
          );
          queryToolbarExpandedWidthRef.current = next.expandedRequiredWidth;
          return next.compact;
        });
      };

      const frame = window.requestAnimationFrame(measure);
      const resizeObserver =
        typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
      resizeObserver?.observe(toolbar);
      const mutationObserver =
        typeof MutationObserver === "undefined"
          ? null
          : new MutationObserver(measure);
      mutationObserver?.observe(toolbar, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      return () => {
        window.cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
      };
    }, [queryToolbarStructureKey, queryToolbarVisible]);

    const tableColumns = activeTab?.tableColumns;
    const tableColumnsByName = useMemo(
      () => new Map(tableColumns?.map((column) => [column.name, column])),
      [tableColumns],
    );

    const layoutColumnIds = useMemo(() => {
      if (isTransposed) return [];
      if (result?.columns?.length) {
        return result.columns.map((_column, index) =>
          resultColumnGridId(result.columns, index),
        );
      }
      return overrideColumns?.map((column) => column.name) || [];
    }, [isTransposed, overrideColumns, result?.columns]);

    useEffect(() => {
      if (!activeTab || layoutColumnIds.length === 0 || isTransposed) return;
      const scope = {
        type: activeTab.type,
        connectionId: activeTab.connectionId,
        databaseName: activeTab.databaseName,
        schemaName: activeTab.schemaName,
        tableName: activeTab.tableName,
        queryLanguage: activeTab.queryLanguage,
        sql: activeTab.resultSql,
      };
      const layoutKey = gridLayoutKey(scope);
      if (!layoutKey) return;
      // Include the ephemeral tab id: closing and reopening the same object
      // must hydrate the new tab from its durable layout rather than inheriting
      // the previous tab's in-memory "already restored" marker.
      const restoreKey = `${activeTab.id}:${layoutKey}:${layoutColumnIds.join("\\u0001")}`;
      if (restoredLayoutRef.current === restoreKey) return;

      restoredLayoutRef.current = restoreKey;
      restoreColumnLayout(
        activeTab.id,
        loadGridLayout(scope, layoutColumnIds) ||
          normalizeGridLayout({}, layoutColumnIds),
      );
    }, [
      activeTab,
      isTransposed,
      layoutColumnIds,
      restoreColumnLayout,
    ]);

    useEffect(() => {
      setQueryResultTransposed(false);
      setValueEditorTarget(null);
      setGridSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
      });
      setContextMenu({ type: null, x: 0, y: 0 });
      setHoverTooltip(null);
    }, [activeTabId, resultIndex]);

    // Column definitions
    const columns = useMemo<GridColumn[]>(() => {
      if (isTransposed && result && result.columns.length > 0) {
        return result.columns.map((column, index) => ({
          title: column.name,
          id: `transpose:${index}`,
          width: Math.round((index === 0 ? 190 : 150) * gridScale),
          icon:
            showTypeIcons && index === 0
              ? GridColumnIcon.HeaderString
              : undefined,
          hasMenu: false,
        }));
      }

      // If we have a result, use its columns
      if (result && result.columns.length > 0) {
        const allColumns = result.columns
          .map((col, index) => {
            const columnId = resultColumnGridId(result.columns, index);
            const isSorted = gridState?.sortColumn === columnId;
            const sortDir = gridState?.sortDirection;
            const customWidth =
              columnWidths[columnId] ?? columnWidths[col.name];

            const metadata = tableColumnsByName.get(col.name);
            const dataType = resolveHeaderColumnType({
              tableColumnType: metadata?.data_type,
              resultColumnType: col.data_type,
            });
            const title = dataType
              ? `${col.name || "Unknown"} (${compactResultColumnType(dataType)})`
              : col.name || "Unknown";
            const columnIcon = dataType
              ? columnIconForType(dataType, metadata?.is_primary_key)
              : undefined;

            return {
              title,
              id: columnId,
              width: Math.round((customWidth || 150) * gridScale),
              icon: isSorted
                ? sortDir === "asc"
                  ? "headerSortAsc"
                  : "headerSortDesc"
                : showTypeIcons
                  ? columnIcon
                  : undefined,
              hasMenu: true,
            };
          })
          .filter((column) => !hiddenColumns.includes(String(column.id)));

        if (!columnOrder || columnOrder.length === 0) {
          return allColumns;
        }

        // ... (reordering logic same as before)
        const orderedColumns: GridColumn[] = [];
        const usedIds = new Set<string>();
        columnOrder.forEach((colId) => {
          const col = allColumns.find((c) => c.id === colId);
          if (col) {
            orderedColumns.push(col);
            usedIds.add(colId);
          }
        });
        allColumns.forEach((col) => {
          if (!usedIds.has(col.id as string)) {
            orderedColumns.push(col);
          }
        });
        return orderedColumns;
      }

      // If no result but we have override columns (fallback for empty table view)
      if (overrideColumns && overrideColumns.length > 0) {
        const metaMap = new Map(tableColumns?.map((c) => [c.name, c]) || []);
        return overrideColumns
          .filter((col) => !hiddenColumns.includes(col.name))
          .map((col) => {
            let title = col.name;
            const meta = metaMap.get(col.name);
            let columnIcon: GridColumnIcon | undefined;
            if (meta) {
              title = `${col.name} (${meta.data_type})`;
              columnIcon = columnIconForType(
                meta.data_type,
                meta.is_primary_key,
              );
            }
            return {
              title,
              id: col.name,
              width: Math.round((columnWidths[col.name] || 150) * gridScale),
              icon: showTypeIcons ? columnIcon : undefined,
              hasMenu: true,
            };
          });
      }

      return [];
    }, [
      result,
      gridState,
      columnWidths,
      columnOrder,
      overrideColumns,
      tableColumns,
      showTypeIcons,
      gridScale,
      hiddenColumns,
      isTransposed,
    ]);

    const columnLookupItems = useMemo<DataGridColumnLookupItem[]>(() => {
      if (isTransposed) return [];
      return columns.map((visualColumn, index) => {
        const resultColumnIndex = result
          ? resultColumnIndexByGridId(result.columns, visualColumn.id)
          : -1;
        const resultColumn = result?.columns[resultColumnIndex];
        const name =
          resultColumn?.name ||
          overrideColumns?.[resultColumnIndex]?.name ||
          String(visualColumn.id);
        const metadata = tableColumnsByName.get(name);
        const detail = [resultColumn?.data_type || metadata?.data_type, metadata?.comment]
          .filter((value): value is string => Boolean(value))
          .join(" · ");
        return { index, name, detail: detail || undefined };
      });
    }, [columns, isTransposed, overrideColumns, result, tableColumnsByName]);

    const filteredColumnLookupItems = useMemo(
      () => filterDataGridColumnLookupItems(columnLookupItems, columnLookupQuery),
      [columnLookupItems, columnLookupQuery],
    );

    const openColumnLookup = useCallback(() => {
      if (columnLookupItems.length === 0) return false;
      setColumnLookupQuery("");
      setColumnLookupSelectedIndex(0);
      setColumnLookupOpen(true);
      return true;
    }, [columnLookupItems.length]);

    const selectColumnLookupItem = useCallback(
      (item: DataGridColumnLookupItem | undefined) => {
        if (!item) return;
        dataEditorRef.current?.scrollTo(item.index, 0, "horizontal", 16, 0, {
          hAlign: "center",
          behavior: "smooth",
        });
        setColumnLookupOpen(false);
        dataEditorRef.current?.focus();
      },
      [],
    );

    const onColumnLookupKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLInputElement>) => {
        const count = filteredColumnLookupItems.length;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          if (!count) return;
          setColumnLookupSelectedIndex((index) =>
            (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
          );
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          selectColumnLookupItem(filteredColumnLookupItems[columnLookupSelectedIndex]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setColumnLookupOpen(false);
        }
      },
      [columnLookupSelectedIndex, filteredColumnLookupItems, selectColumnLookupItem],
    );

    useEffect(() => {
      if (!columnLookupOpen) return;
      const timer = window.setTimeout(() => columnLookupInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }, [columnLookupOpen]);

    useEffect(() => {
      setColumnLookupSelectedIndex(0);
    }, [columnLookupQuery]);

    useEffect(() => {
      setColumnLookupSelectedIndex((current) =>
        Math.min(current, Math.max(filteredColumnLookupItems.length - 1, 0)),
      );
    }, [filteredColumnLookupItems.length]);

    // Apply filters and sorting
    const sortedIndices = useMemo(() => {
      if (!result) return [];

      if (isTransposed) {
        return result.rows.map((_, index) => index);
      }

      let indices = result.rows.map((_, i) => i);

      // Apply column filters (from query builder filter row)
      if (columnFilters.length > 0 && result) {
        indices = indices.filter((rowIndex) => {
          // Evaluate filters with AND/OR logic
          let passesFilter = true;

          for (let i = 0; i < columnFilters.length; i++) {
            const filter = columnFilters[i];
            if (!filter) continue;

            const colIndex = result.columns.findIndex(
              (c) => c.name === filter.column,
            );

            if (colIndex === -1) continue;

            const cellValue = result.rows[rowIndex]?.[colIndex];
            const matches = applyFilter(cellValue, filter);

            if (i === 0) {
              // First filter sets the initial state
              passesFilter = matches;
            } else {
              // Subsequent filters use their logic operator
              if (filter.logic === "OR") {
                passesFilter = passesFilter || matches;
              } else {
                // Default to AND
                passesFilter = passesFilter && matches;
              }
            }
          }

          return passesFilter;
        });
      }

      // Apply global filter
      if (globalFilter && result) {
        const searchLower = globalFilter.toLowerCase();
        indices = indices.filter((i) =>
          result.rows[i]?.some((cell) =>
            String(cell).toLowerCase().includes(searchLower),
          ),
        );
      }

      const localColumnFilters = gridState?.columnFilters || {};
      const localFilterEntries = Object.entries(localColumnFilters).filter(
        ([, filter]) => filter?.value,
      );
      if (localFilterEntries.length > 0) {
        indices = indices.filter((rowIndex) =>
          localFilterEntries.every(([column, filter]) => {
            const colIndex = resultColumnIndexByGridId(result.columns, column);
            if (colIndex === -1) return true;

            return applyFilter(result.rows[rowIndex]?.[colIndex], {
              operator: filter.operator as ColumnFilter["operator"],
              value: filter.value,
            });
          }),
        );
      }

      // Apply sorting
      if (
        activeTab?.type !== "table" &&
        gridState?.sortColumn &&
        gridState?.sortDirection &&
        result
      ) {
        const colIndex = resultColumnIndexByGridId(
          result.columns,
          gridState.sortColumn,
        );
        if (colIndex >= 0) {
          indices = sortDataGridRowIndexes({
            rows: result.rows,
            rowIndexes: indices,
            columnIndex: colIndex,
            direction: gridState.sortDirection,
            columnType: result.columns[colIndex]?.data_type,
          });
        }
      }

      return indices;
    }, [result, gridState, globalFilter, columnFilters, activeTab?.type, isTransposed]);

    const visualRows = useMemo(
      () =>
        buildDataGridVisualRows(
          sortedIndices,
          newRowsCount,
          activeTab?.newRowPlacements,
        ),
      [activeTab?.newRowPlacements, newRowsCount, sortedIndices],
    );

    const selectedRowIndexes = useMemo(
      () =>
        gridSelection.rows
          .toArray()
          .map((row) => visualRows[row]?.rowKey)
          .filter((rowIndex): rowIndex is number => rowIndex !== undefined && rowIndex >= 0),
      [gridSelection.rows, visualRows],
    );

    useEffect(() => {
      onSelectionSummaryChange?.({
        selectedRowCount: selectedRowIndexes.length,
      });
    }, [onSelectionSummaryChange, selectedRowIndexes.length]);

    const aggregateColumnMetadata = useMemo(
      () =>
        columns.map((visualColumn) => {
          const originalColumnIndex = result
            ? isTransposed
              ? Number(String(visualColumn.id).replace("transpose:", ""))
              : resultColumnIndexByGridId(result.columns, visualColumn.id)
            : -1;
          const resultColumn = result?.columns[originalColumnIndex];
          return {
            originalColumnIndex,
            dataType:
              resultColumn?.data_type ||
              tableColumnsByName.get(resultColumn?.name || "")?.data_type,
          };
        }),
      [columns, result, tableColumnsByName, isTransposed],
    );

    const selectionAggregate = useMemo(() => {
      if (
        !result ||
        isTransposed ||
        columns.length === 0 ||
        deferredGridSelectionContext.activeTabId !== activeTabId ||
        deferredGridSelectionContext.resultIndex !== resultIndex
      ) {
        return null;
      }
      const deferredGridSelection = deferredGridSelectionContext.selection;
      const current = deferredGridSelection.current;
      const selection = collectSelectionCoordinates({
        ranges: current ? [current.range, ...current.rangeStack] : [],
        rows: deferredGridSelection.rows.toArray(),
        columns: deferredGridSelection.columns.toArray(),
        rowCount: visualRows.length,
        columnCount: columns.length,
      });
      if (selection.coordinates.length <= 1) return null;

      const cells = selection.coordinates.map(([row, column]) => {
        const columnMetadata = aggregateColumnMetadata[column];
        if (!columnMetadata) return { value: undefined };
        const { originalColumnIndex } = columnMetadata;
        if (originalColumnIndex < 0) return { value: undefined };

        const visualRow = visualRows[row];
        if (!visualRow) return { value: undefined };
        const { isNew: isNewRow, rowKey } = visualRow;
        const editKey = `${rowKey}:${originalColumnIndex}`;
        const pendingValue = pendingEdits.has(editKey)
          ? pendingEdits.get(editKey)
          : isNewRow
            ? undefined
            : result.rows[rowKey]?.[originalColumnIndex];

        return {
          // An uncommitted expression has no observable scalar value yet, so
          // never feed it into local numeric aggregates.
          value: isTableCellExpression(pendingValue) ? undefined : pendingValue,
          dataType: columnMetadata.dataType,
        };
      });

      return summarizeSelection(cells, selection.truncated);
    }, [
      columns,
      activeTabId,
      aggregateColumnMetadata,
      deferredGridSelectionContext,
      pendingEdits,
      result,
      resultIndex,
      isTransposed,
      visualRows,
    ]);

    // Update getCellContent to handle missing result & new rows
    const getCellContent = useCallback(
      (cell: Item): GridCell => {
        const [col, row] = cell;

        // Handle loading/empty state where result is null but overrideColumns exists
        if (!result && (!overrideColumns || overrideColumns.length === 0)) {
          return {
            kind: GridCellKind.Text,
            displayData: "",
            data: "",
            allowOverlay: false,
          };
        }

        const visualRow = visualRows[row];
        if (!visualRow) {
          return {
            kind: GridCellKind.Text,
            displayData: "",
            data: "",
            allowOverlay: false,
          };
        }
        const isNewRow = visualRow.isNew;

        // Determine the "Row Key" for editing/retrieval
        let editRowKey: number;
        let actualRowIndex: number | undefined;

        if (isNewRow) {
          editRowKey = visualRow.rowKey;
          actualRowIndex = undefined;
        } else {
          actualRowIndex = visualRow.rowKey;
          if (actualRowIndex === undefined) {
            return {
              kind: GridCellKind.Text,
              displayData: "",
              data: "",
              allowOverlay: false,
            };
          }
          editRowKey = actualRowIndex;
        }

        // If existing row but invalid index
        if (
          !isNewRow &&
          (actualRowIndex === undefined ||
            (result && !result.rows[actualRowIndex]))
        ) {
          return {
            kind: GridCellKind.Text,
            displayData: "",
            data: "",
            allowOverlay: false,
          };
        }

        // Map visual column index to actual data column index
        const visualColumn = columns[col];
        if (!visualColumn) {
          return {
            kind: GridCellKind.Text,
            displayData: "",
            data: "",
            allowOverlay: false,
          };
        }

        // Determine original column index
        let originalColIndex = -1;
        if (result && result.columns.length > 0) {
          originalColIndex = isTransposed
            ? col
            : resultColumnIndexByGridId(result.columns, visualColumn.id);
        } else if (overrideColumns) {
          originalColIndex = overrideColumns.findIndex(
            (c) => c.name === visualColumn.id,
          );
        }

        if (originalColIndex === -1) {
          return {
            kind: GridCellKind.Text,
            displayData: "",
            data: "",
            allowOverlay: false,
          };
        }

        // Retrieval Value
        const editKey = `${editRowKey}:${originalColIndex}`;
        let val: any = undefined;

        if (pendingEdits.has(editKey)) {
          val = pendingEdits.get(editKey);
        } else {
          // If not in pending edits, get from result if existing row
          if (!isNewRow && result && actualRowIndex !== undefined) {
            val = result.rows[actualRowIndex]?.[originalColIndex];
          }
        }

        const columnName =
          result?.columns[originalColIndex]?.name ||
          overrideColumns?.[originalColIndex]?.name;
        const metadata = tableColumnsByName.get(columnName || "");
        const cellEditable = isEditable && isTableColumnEditable(metadata);
        const baseCell = createTypedCell(
          isTableCellExpression(val) ? `ƒx ${val.expression}` : val,
          cellEditable,
          isNewRow ? "DEFAULT" : "NOT LOADED",
          resolveRenderedColumnType({
            resultColumnType: result?.columns[originalColIndex]?.data_type,
            tableColumnType:
              metadata?.data_type || overrideColumns?.[originalColIndex]?.type,
          }),
        );
        const gridCell = { ...baseCell };

        if (pendingEdits.has(editKey)) {
          gridCell.themeOverride = {
            ...gridCell.themeOverride,
            bgCell: cssHslVarAlpha(
              "--wb-accent",
              0.12,
              "rgba(91, 137, 214, 0.12)",
            ),
          };
        }

        // Force editable for compatible types
        if (gridCell.kind !== GridCellKind.Boolean) {
          (gridCell as any).allowOverlay =
            cellEditable &&
            !dataGridCellUsesFullValueEditor(
              val,
              metadata?.data_type ||
                result?.columns[originalColIndex]?.data_type ||
                overrideColumns?.[originalColIndex]?.type,
            );
          (gridCell as any).readonly = !cellEditable;
        }

        // Apply theme override for new rows
        if (isNewRow) {
          gridCell.themeOverride = {
            ...gridCell.themeOverride,
            bgCell: cssHslVarAlpha(
              "--wb-accent",
              0.09,
              "rgba(91, 137, 214, 0.09)",
            ),
          };
        }

        return gridCell;
      },
      [
        result,
        visualRows,
        pendingEdits,
        columns,
        overrideColumns,
        isEditable,
        tableColumns,
        isTransposed,
      ],
    );

    // Handle header menu/arrow click for sorting
    // 'col' is visual index
    const onHeaderMenuClick = useCallback(
      (
        col: number,
        _bounds: { x: number; y: number; width: number; height: number },
      ) => {
        if (!activeTab || !result || isTransposed) return;

        const visualColumn = columns[col];
        if (!visualColumn) return;

        const originalColumnIndex = resultColumnIndexByGridId(
          result.columns,
          visualColumn.id,
        );
        const column = result.columns[originalColumnIndex];
        if (!column) return;

        const currentSort = gridState?.sortColumn;
        const currentDir = gridState?.sortDirection;

        let newDirection: "asc" | "desc" | null = "asc";

        const columnId = String(visualColumn.id);
        if (currentSort === columnId) {
          // Cycling: asc -> desc -> none
          if (currentDir === "asc") {
            newDirection = "desc";
          } else if (currentDir === "desc") {
            newDirection = null;
          }
        }

        setGridSort(activeTab.id, newDirection ? columnId : null, newDirection);
      },
      [activeTab, result, gridState, setGridSort, columns, isTransposed],
    );

    // Handle cell edit
    const onCellEdited = useCallback(
      (cell: Item, newValue: EditableGridCell): void => {
        if (!activeTab || !isEditable) return;

        const [col, row] = cell;

        // Extract value
        let value: any;
        if ("data" in newValue) {
          value = newValue.data;
        } else {
          value = null;
        }

        // Helper to map visual (r,c) to data indices
        const getIndices = (r: number, c: number) => {
          const actualRowKey = visualRows[r]?.rowKey;

          const vCol = columns[c];
          if (!vCol) return null;

          let origColIdx = -1;
          if (result && result.columns.length > 0) {
            origColIdx = resultColumnIndexByGridId(result.columns, vCol.id);
          } else if (overrideColumns) {
            origColIdx = overrideColumns.findIndex(
              (col) => col.name === vCol.id,
            );
          }

          if (actualRowKey === undefined || origColIdx === -1) return null;
          const columnName =
            result?.columns[origColIdx]?.name ||
            overrideColumns?.[origColIdx]?.name;
          const metadata = tableColumnsByName.get(columnName || "");
          if (!isTableColumnEditable(metadata)) return null;
          const dataType =
            metadata?.data_type ||
            result?.columns[origColIdx]?.data_type ||
            overrideColumns?.[origColIdx]?.type;
          return { rowIndex: actualRowKey, colIndex: origColIdx, dataType };
        };

        const edits: Array<{ rowIndex: number; colIndex: number; value: any }> =
          [];
        let appliedToSelection = false;
        const range = gridSelection.current?.range;

        if (range) {
          const { x, y, width, height } = range;
          // Check if edited cell is inside the selection range
          if (col >= x && col < x + width && row >= y && row < y + height) {
            appliedToSelection = true;
            for (let r = y; r < y + height; r++) {
              for (let c = x; c < x + width; c++) {
                const indices = getIndices(r, c);
                if (indices) {
                  edits.push({
                    rowIndex: indices.rowIndex,
                    colIndex: indices.colIndex,
                    value: normalizeDataGridNumericInput(value, indices.dataType),
                  });
                }
              }
            }
          }
        }

        if (!appliedToSelection) {
          const indices = getIndices(row, col);
          if (indices) {
            edits.push({
              rowIndex: indices.rowIndex,
              colIndex: indices.colIndex,
              value: normalizeDataGridNumericInput(value, indices.dataType),
            });
          }
        }

        if (edits.length > 0) {
          const firstEdit = edits[0];
          if (edits.length === 1 && firstEdit) {
            setCellEdit(
              activeTab.id,
              firstEdit.rowIndex,
              firstEdit.colIndex,
              firstEdit.value,
            );
          } else {
            setBulkCellEdit(activeTab.id, edits);
          }
        }
      },
      [
        activeTab,
        result,
        visualRows,
        setCellEdit,
        setBulkCellEdit,
        columns,
        overrideColumns,
        gridSelection,
        isEditable,
        tableColumnsByName,
      ],
    );

    // Column resize handler
    const onColumnResize = useCallback(
      (column: GridColumn, newSize: number) => {
        if (!activeTab || !column.id || isTransposed) return;
        setColumnWidth(
          activeTab.id,
          column.id,
          Math.round(newSize / gridScale),
        );
      },
      [activeTab, gridScale, setColumnWidth, isTransposed],
    );

    // Column move handler
    const onColumnMoved = useCallback(
      (startIndex: number, endIndex: number) => {
        if (!activeTab || isTransposed) return;

        const newOrder = [...columns]
          .map((c) => c.id || "")
          .filter(Boolean) as string[];
        const [moved] = newOrder.splice(startIndex, 1);
        if (moved) {
          newOrder.splice(endIndex, 0, moved);
          setColumnOrder(activeTab.id, newOrder);
        }
      },
      [activeTab, columns, setColumnOrder, isTransposed],
    );

    const visualColumnIndexToResultIndex = useCallback(
      (visualColumnIndex: number) => {
        const visualColumn = columns[visualColumnIndex];
        if (!visualColumn) return -1;
        if (result) {
          if (isTransposed) return visualColumnIndex;
          return resultColumnIndexByGridId(result.columns, visualColumn.id);
        }
        return (
          overrideColumns?.findIndex(
            (column) => column.name === visualColumn.id,
          ) ?? -1
        );
      },
      [columns, overrideColumns, result, isTransposed],
    );

    const pasteColumns = useMemo(
      () =>
        columns.map((_, visualColumnIndex) => {
          const columnIndex = visualColumnIndexToResultIndex(visualColumnIndex);
          const resultColumn = result?.columns[columnIndex];
          const fallbackColumn = overrideColumns?.[columnIndex];
          const metadata = tableColumnsByName.get(
            resultColumn?.name || fallbackColumn?.name || "",
          );
          return {
            columnIndex,
            editable: columnIndex >= 0 && isTableColumnEditable(metadata),
            dataType:
              metadata?.data_type ||
              resultColumn?.data_type ||
              fallbackColumn?.type,
          };
        }),
      [
        columns,
        overrideColumns,
        result,
        tableColumnsByName,
        visualColumnIndexToResultIndex,
      ],
    );

    const onCellsEdited = useCallback(
      (items: readonly EditListItem[]): boolean | void => {
        if (!activeTab || !isEditable || items.length <= 1) return;
        const edits = items.flatMap(({ location: [column, row], value }) => {
          const visualRow = visualRows[row];
          const pasteColumn = pasteColumns[column];
          if (!visualRow || !pasteColumn?.editable || !("data" in value)) {
            return [];
          }
          return [
            {
              rowIndex: visualRow.rowKey,
              colIndex: pasteColumn.columnIndex,
              value: normalizeDataGridNumericInput(
                value.data,
                pasteColumn.dataType,
              ),
            },
          ];
        });
        if (edits.length > 0) setBulkCellEdit(activeTab.id, edits);
        // Suppress Glide's per-cell callback even when every item became
        // readonly between paste parsing and this atomic store update.
        return true;
      },
      [activeTab, isEditable, pasteColumns, setBulkCellEdit, visualRows],
    );

    const onPaste = useCallback(
      (target: Item, values: readonly (readonly string[])[]): boolean => {
        if (!activeTab || !isEditable) return true;
        const plan = planExpandableNewRowPaste({
          target,
          selection: gridSelection.current?.range,
          selectedRows: gridSelection.rows.toArray(),
          hasColumnSelection: gridSelection.columns.length > 0,
          pastedRows: values,
          visualRows,
          pendingEdits,
          visibleColumns: pasteColumns,
        });
        if (!plan) return true;

        const rows = plan.rows.map((row) =>
          row.map((cell) => {
            const normalized = normalizeDataGridNumericInput(
              cell.value,
              cell.dataType,
            );
            return {
              ...cell,
              value:
                normalized === null || typeof normalized === "string"
                  ? normalized
                  : cell.value,
            };
          }),
        );
        const handled = applyNewRowPaste(
          activeTab.id,
          plan.targetRowKey,
          plan.reusableRowKeys,
          rows,
        );
        // Glide proceeds with its bounded paste only when true is returned.
        return !handled;
      },
      [
        activeTab,
        applyNewRowPaste,
        gridSelection.current?.range,
        gridSelection.columns,
        gridSelection.rows,
        isEditable,
        pasteColumns,
        pendingEdits,
        visualRows,
      ],
    );

    const openValueEditor = useCallback(
      (cell: Item) => {
        if (!activeTab) return;
        const [visualColumnIndex, visualRowIndex] = cell;
        const columnIndex = visualColumnIndexToResultIndex(visualColumnIndex);
        if (columnIndex < 0) return;

        const visualRow = visualRows[visualRowIndex];
        if (!visualRow) return;
        const { rowKey: rowIndex } = visualRow;

        const resultColumn = result?.columns[columnIndex];
        const fallbackColumn = overrideColumns?.[columnIndex];
        const columnName = resultColumn?.name || fallbackColumn?.name;
        if (!columnName) return;
          const metadata = tableColumnsByName.get(columnName || "");
        const columnEditability = tableColumnEditability(metadata);
        const cellEditable =
          isEditable &&
          !activeTab.isExecuting &&
          columnEditability === "editable";
        const editKey = `${rowIndex}:${columnIndex}`;
        const pending = pendingEdits.has(editKey);
        const originalValue =
          rowIndex >= 0 ? result?.rows[rowIndex]?.[columnIndex] : undefined;
        const pendingValue = pending ? pendingEdits.get(editKey) : undefined;
        const expression = isTableCellExpression(pendingValue)
          ? pendingValue.expression
          : undefined;
        const value = expression === undefined ? (pending ? pendingValue : originalValue) : originalValue;
        const pageOffset =
          activeTab.type === "table"
            ? (activeTab.tablePage || 0) * (activeTab.tablePageSize || 0)
            : 0;

        setValueEditorTarget({
          key: `${activeTab.id}:${editKey}`,
          tabId: activeTab.id,
          rowIndex,
          columnIndex,
          columnName,
          columnType:
            metadata?.data_type ||
            resultColumn?.data_type ||
            fallbackColumn?.type,
          rowLabel:
            rowIndex < 0
              ? `New row ${Math.abs(rowIndex)}`
              : `Row ${(pageOffset + rowIndex + 1).toLocaleString()}`,
          value,
          originalValue,
          editable: cellEditable,
          nullable: metadata?.is_nullable !== false,
          pending,
          defaultValue: metadata?.default_value,
          expression,
          expressionAllowed: cellEditable && rowIndex >= 0,
          readOnlyReason: cellEditable
            ? undefined
            : tableColumnReadOnlyReason(columnEditability),
        });
      },
      [
        activeTab,
        isEditable,
        overrideColumns,
        pendingEdits,
        result,
        visualRows,
        tableColumnsByName,
        visualColumnIndexToResultIndex,
      ],
    );

    const onGridKeyDown = useCallback(
      (event: GridKeyEventArgs) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLocaleLowerCase() === "g" &&
          openColumnLookup()
        ) {
          event.preventDefault();
          event.cancel();
          return;
        }
        if (
          event.shiftKey &&
          event.key === "Enter" &&
          event.location &&
          event.location[1] >= 0
        ) {
          event.preventDefault();
          event.cancel();
          openValueEditor(event.location);
        }
      },
      [openColumnLookup, openValueEditor],
    );

    const onCellActivated = useCallback(
      (cell: Item) => {
        const [visualColumnIndex] = cell;
        const originalColumnIndex = visualColumnIndexToResultIndex(visualColumnIndex);
        if (originalColumnIndex < 0) return;
        const gridCell = getCellContent(cell);
        const dataType =
          result?.columns[originalColumnIndex]?.data_type ||
          overrideColumns?.[originalColumnIndex]?.type;
        if (
          dataGridCellUsesFullValueEditor(
            gridCellTooltipText(gridCell),
            dataType,
          )
        ) {
          openValueEditor(cell);
        }
      },
      [
        getCellContent,
        openValueEditor,
        overrideColumns,
        result,
        visualColumnIndexToResultIndex,
      ],
    );

    const valueEditorNavigation = useMemo(() => {
      if (!valueEditorTarget || valueEditorTarget.editable || isTransposed) {
        return undefined;
      }
      const rowPosition = visualRows.findIndex(
        (row) => row.rowKey === valueEditorTarget.rowIndex,
      );
      const columnPosition = columns.findIndex(
        (_, visualColumnIndex) =>
          visualColumnIndexToResultIndex(visualColumnIndex) ===
          valueEditorTarget.columnIndex,
      );
      return {
        up: adjacentDataGridDetailIndex(rowPosition, -1, visualRows.length) !== null,
        down: adjacentDataGridDetailIndex(rowPosition, 1, visualRows.length) !== null,
        left: adjacentDataGridDetailIndex(columnPosition, -1, columns.length) !== null,
        right: adjacentDataGridDetailIndex(columnPosition, 1, columns.length) !== null,
      };
    }, [
      columns,
      isTransposed,
      valueEditorTarget,
      visualColumnIndexToResultIndex,
      visualRows,
    ]);

    const navigateValueEditor = useCallback(
      (
        axis: DataGridDetailNavigationAxis,
        delta: DataGridDetailNavigationDelta,
      ) => {
        if (!valueEditorTarget || valueEditorTarget.editable || isTransposed) return;
        const rowPosition = visualRows.findIndex(
          (row) => row.rowKey === valueEditorTarget.rowIndex,
        );
        const columnPosition = columns.findIndex(
          (_, visualColumnIndex) =>
            visualColumnIndexToResultIndex(visualColumnIndex) ===
            valueEditorTarget.columnIndex,
        );
        const nextRowPosition =
          axis === "row"
            ? adjacentDataGridDetailIndex(rowPosition, delta, visualRows.length)
            : rowPosition;
        const nextColumnPosition =
          axis === "column"
            ? adjacentDataGridDetailIndex(columnPosition, delta, columns.length)
            : columnPosition;
        if (nextRowPosition === null || nextColumnPosition === null) return;
        openValueEditor([nextColumnPosition, nextRowPosition]);
      },
      [
        columns,
        isTransposed,
        openValueEditor,
        valueEditorTarget,
        visualColumnIndexToResultIndex,
        visualRows,
      ],
    );

    const handleCopyAll = useCallback(async () => {
      if (!result || result.rows.length === 0) return;

      const rowIndexes = result.rows.map((_, index) => index);
      const columnIndexes = result.columns.map((_, index) => index);
      const text = serializeQueryResultSelectionToTsv(
        result,
        rowIndexes,
        columnIndexes,
        copyIncludeHeaders,
        activeConnection?.driver,
      );

      try {
        await navigator.clipboard.writeText(text);
        console.log("Copied query result to clipboard");
      } catch (err) {
        console.error("Failed to copy query result:", err);
      }
    }, [activeConnection?.driver, copyIncludeHeaders, result]);

    const handleExport = useCallback(
      (
        format: QueryResultExportFormat,
        extension: "csv" | "json" | "jsonl" | "md" | "tsv" | "sql",
      ) => {
        if (!result) return;
        exportQueryResult(
          result,
          format,
          exportFilename(activeTab?.title, extension),
        );
      },
      [activeTab?.title, result],
    );

    // Copy selected cells to clipboard
    const onCopy = useCallback(
      async (selection: GridSelection) => {
        if (!result) return;

        const range = selection.current?.range;
        let selectedVisualRows = selection.rows.toArray();
        let visualColumns = selection.columns.toArray();

        if (selectedVisualRows.length === 0 && range) {
          selectedVisualRows = rangeIndexes(range.y, range.height);
        }
        if (visualColumns.length === 0 && range) {
          visualColumns = rangeIndexes(range.x, range.width);
        }
        if (selectedVisualRows.length === 0 && visualColumns.length > 0) {
          selectedVisualRows = visualRows.map((_, index) => index);
        }

        const selectedRows = selectedVisualRows.flatMap((visualRowIndex) => {
          const visualRow = visualRows[visualRowIndex];
          if (!visualRow) return [];
          return [
            result.columns.map((_, columnIndex) => {
              const editKey = `${visualRow.rowKey}:${columnIndex}`;
              if (pendingEdits.has(editKey)) return pendingEdits.get(editKey);
              return visualRow.rowKey >= 0
                ? result.rows[visualRow.rowKey]?.[columnIndex]
                : undefined;
            }),
          ];
        });
        const selectionResult = { ...result, rows: selectedRows };
        const rowIndexes = selectedRows.map((_, index) => index);
        const columnIndexes =
          visualColumns.length > 0
            ? visualColumns
                .map(visualColumnIndexToResultIndex)
                .filter((columnIndex) => columnIndex >= 0)
            : result.columns.map((_, index) => index);
        const text = serializeQueryResultSelectionToTsv(
          selectionResult,
          rowIndexes,
          columnIndexes,
          copyIncludeHeaders,
          activeConnection?.driver,
        );

        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            console.log("Copied to clipboard");
          } catch (err) {
            console.error("Failed to copy:", err);
          }
        }
      },
      [
        activeConnection?.driver,
        copyIncludeHeaders,
        pendingEdits,
        result,
        visualColumnIndexToResultIndex,
        visualRows,
      ],
    );

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
      if (contextMenu.col === undefined || contextMenu.row === undefined)
        return;
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
      if (
        contextMenu.col !== undefined &&
        contextMenu.col < frozenColumnCount
      ) {
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

    useImperativeHandle(
      ref,
      () => ({
        openSearch: () => {
          setShowSearch(true);
          dataEditorRef.current?.focus();
        },
        openColumnLookup,
        fitColumns: () => {
          if (columns.length === 0) return;
          dataEditorRef.current?.remeasureColumns(
            CompactSelection.fromSingleSelection([0, columns.length]),
          );
        },
        deleteSelectedRows: handleDeleteSelectedRows,
        getSelectedRowIndexes: () => [...selectedRowIndexes],
      }),
      [columns.length, handleDeleteSelectedRows, openColumnLookup, selectedRowIndexes],
    );

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
      if (
        contextMenu.row === undefined ||
        contextMenu.row < 0
      ) {
        return undefined;
      }
      const rowKey = visualRows[contextMenu.row]?.rowKey;
      return rowKey !== undefined && rowKey >= 0 ? rowKey : undefined;
    }, [contextMenu.row, visualRows]);

    const handleCloneRows = useCallback(() => {
      if (!activeTab || contextSourceRowIndex === undefined || !isEditable) return;
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
      const value = String(contextCellValue ?? "").replace(/\s+/g, " ").trim();
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

    const contextMenuItems = useMemo<DataGridContextMenuItem[]>(() => {
      if (contextMenu.type === "header") {
        return [
          {
            id: "copy-column-name",
            label: "Copy Column Name",
            description: "Copy this column identifier to the clipboard.",
            icon: <Copy size={12} />,
            onSelect: handleCopyColumnName,
          },
          {
            id: "sort-ascending",
            label: "Sort Ascending",
            description: "Order the visible rows by this column.",
            icon: <ArrowUpAZ size={12} />,
            separatorBefore: true,
            onSelect: handleSortAsc,
          },
          {
            id: "sort-descending",
            label: "Sort Descending",
            description: "Order the visible rows by this column.",
            icon: <ArrowDownAZ size={12} />,
            onSelect: handleSortDesc,
          },
          {
            id: "clear-sort",
            label: "Clear Sort",
            description: "Restore the result's original row order.",
            icon: <RotateCcw size={12} />,
            disabled: !gridState?.sortColumn,
            onSelect: handleClearSort,
          },
          {
            id: "column-filter",
            label: "Set Column Filter...",
            description: "Filter the visible result using this column.",
            icon: <Search size={12} />,
            separatorBefore: true,
            onSelect: handleOpenColumnFilter,
          },
          {
            id: "hide-column",
            label: "Hide Column",
            description: "Hide this column only in the current grid layout.",
            icon: <EyeOff size={12} />,
            disabled: columns.length <= 1,
            separatorBefore: true,
            onSelect: handleHideColumn,
          },
          {
            id: "show-all-columns",
            label: "Show All Columns",
            description: "Restore every hidden column in this grid.",
            icon: <Eye size={12} />,
            disabled: hiddenColumns.length === 0,
            onSelect: handleShowAllColumns,
          },
          {
            id: "freeze-through-column",
            label: "Freeze Through This Column",
            description: "Keep this and preceding columns visible while scrolling.",
            icon: <Pin size={12} />,
            disabled:
              contextMenu.col === undefined ||
              frozenColumnCount === contextMenu.col + 1,
            separatorBefore: true,
            onSelect: handleFreezeThroughColumn,
          },
          {
            id: "unfreeze-columns",
            label: "Unfreeze Columns",
            description: "Allow every column to scroll normally.",
            icon: <PinOff size={12} />,
            disabled: frozenColumnCount === 0,
            onSelect: handleUnfreezeColumns,
          },
        ];
      }
      if (contextMenu.type === "cell") {
        return [
          {
            id: "open-value-editor",
            label: "Open Value Editor...",
            description: "Inspect or edit the complete cell value.",
            icon: <SquarePen size={12} />,
            shortcut: "⇧↵",
            onSelect: handleOpenValueEditor,
          },
          {
            id: "copy-cell",
            label: "Copy",
            description: "Copy the selected grid cells to the clipboard.",
            icon: <Copy size={12} />,
            shortcut: "⌘C",
            separatorBefore: true,
            onSelect: () => void onCopy(gridSelection),
          },
          {
            id: "filter-current-result",
            label: "Filter Current Result",
            description: "Filter rows already loaded in this grid.",
            icon: <Search size={12} />,
            children: [
              {
                id: "filter-local-equals",
                label: `Equals ${contextValueLabel}`,
                onSelect: () =>
                  handleLocalCellFilter(
                    contextCellValue === null ? "isNull" : "equals",
                  ),
              },
              {
                id: "filter-local-not-equals",
                label: `Does Not Equal ${contextValueLabel}`,
                onSelect: () =>
                  handleLocalCellFilter(
                    contextCellValue === null ? "isNotNull" : "notEquals",
                  ),
              },
              {
                id: "filter-local-contains",
                label: `Contains ${contextValueLabel}`,
                disabled: contextCellValue == null,
                separatorBefore: true,
                onSelect: () => handleLocalCellFilter("contains"),
              },
              {
                id: "filter-local-not-contains",
                label: `Does Not Contain ${contextValueLabel}`,
                disabled: contextCellValue == null,
                onSelect: () => handleLocalCellFilter("notContains"),
              },
              {
                id: "filter-local-null",
                label: "Is NULL",
                separatorBefore: true,
                onSelect: () => handleLocalCellFilter("isNull"),
              },
              {
                id: "filter-local-not-null",
                label: "Is Not NULL",
                onSelect: () => handleLocalCellFilter("isNotNull"),
              },
              {
                id: "filter-local-clear",
                label: "Clear Column Filter",
                disabled: !contextMenu.columnId
                  ? true
                  : !gridState?.columnFilters?.[contextMenu.columnId],
                separatorBefore: true,
                onSelect: handleClearLocalColumnFilter,
              },
            ],
          },
          ...(activeTab?.type === "table" && contextCellValue != null
            ? [
                {
                  id: "filter-entire-table",
                  label: "Filter Entire Table",
                  description: "Reload the table with a server-side filter.",
                  icon: <Database size={12} />,
                  children: [
                    {
                      id: "filter-database-equals",
                      label: `Equals ${contextValueLabel}`,
                      onSelect: () =>
                        void handleDatabaseCellFilter("equals"),
                    },
                    {
                      id: "filter-database-contains",
                      label: `Contains ${contextValueLabel}`,
                      onSelect: () =>
                        void handleDatabaseCellFilter("contains"),
                    },
                    {
                      id: "filter-database-greater",
                      label: `Greater Than ${contextValueLabel}`,
                      separatorBefore: true,
                      onSelect: () => void handleDatabaseCellFilter(">"),
                    },
                    {
                      id: "filter-database-less",
                      label: `Less Than ${contextValueLabel}`,
                      onSelect: () => void handleDatabaseCellFilter("<"),
                    },
                  ],
                } satisfies DataGridContextMenuItem,
              ]
            : []),
          ...contextForeignKeyPlans.map((plan, index) => ({
            id: `foreign-key-${plan.direction}-${plan.constraintName}-${index}`,
            label: foreignKeyNavigationLabel(plan),
            description:
              plan.direction === "referenced"
                ? "Open the row referenced by this foreign key."
                : "Show rows that reference the selected value.",
            icon:
              plan.direction === "referenced" ? (
                <ArrowUpRight size={12} />
              ) : (
                <Rows3 size={12} />
              ),
            separatorBefore: index === 0,
            onSelect: () => void handleForeignKeyNavigation(plan),
          })),
          ...(contextSourceRowIndex !== undefined &&
          (onEditDocument || onCloneDocument || onDeleteDocument)
            ? [
                ...(onEditDocument
                  ? [
                      {
                        id: "edit-native-document",
                        label: "Edit MongoDB Document...",
                        description: "Review field changes before saving.",
                        icon: <SquarePen size={12} />,
                        separatorBefore: true,
                        onSelect: () => {
                          closeContextMenu();
                          onEditDocument(contextSourceRowIndex);
                        },
                      } satisfies DataGridContextMenuItem,
                    ]
                  : []),
                ...(onCloneDocument
                  ? [
                      {
                        id: "clone-native-document",
                        label: "Clone MongoDB Document...",
                        description: "Create a reviewed copy with a new identity.",
                        icon: <Copy size={12} />,
                        onSelect: () => {
                          closeContextMenu();
                          onCloneDocument(contextSourceRowIndex);
                        },
                      } satisfies DataGridContextMenuItem,
                    ]
                  : []),
                ...(onDeleteDocument
                  ? [
                      {
                        id: "delete-native-document",
                        label: "Delete MongoDB Document...",
                        description: "Review the exact document before deletion.",
                        icon: <Trash2 size={12} />,
                        danger: true,
                        onSelect: () => {
                          closeContextMenu();
                          onDeleteDocument(contextSourceRowIndex);
                        },
                      } satisfies DataGridContextMenuItem,
                    ]
                  : []),
              ]
            : []),
          ...(activeTab?.type === "table" &&
          contextSourceRowIndex !== undefined &&
          !onCloneDocument
            ? [
                {
                  id: "clone-table-rows",
                  label:
                    selectedRowIndexes.length > 1 &&
                    selectedRowIndexes.includes(contextSourceRowIndex)
                      ? `Clone ${selectedRowIndexes.length} Rows`
                      : "Clone Row",
                  description: "Stage a copy directly below each source row.",
                  icon: <Copy size={12} />,
                  disabled: !isEditable,
                  separatorBefore: true,
                  onSelect: handleCloneRows,
                } satisfies DataGridContextMenuItem,
              ]
            : []),
          {
            id: "set-cell-null",
            label: "Set NULL",
            description: "Stage a NULL value; write it with Submit changes.",
            icon: <CircleSlash2 size={12} />,
            disabled: !isEditable || !contextColumnAllowsNull,
            separatorBefore: true,
            onSelect: handleSetCellNull,
          },
          {
            id: "delete-selected-rows",
            label: "Delete Selected Rows",
            description: "Delete selected rows after confirmation.",
            icon: <Trash2 size={12} />,
            danger: true,
            disabled: !isEditable || selectedRowIndexes.length === 0,
            separatorBefore: true,
            onSelect: () => void handleDeleteSelectedRows(),
          },
        ];
      }
      return [];
    }, [
      contextMenu.type,
      activeTab?.type,
      gridSelection,
      gridState?.columnFilters,
      gridState?.sortColumn,
      handleClearSort,
      handleCopyColumnName,
      handleDeleteSelectedRows,
      handleOpenColumnFilter,
      handleHideColumn,
      handleOpenValueEditor,
      handleShowAllColumns,
      handleFreezeThroughColumn,
      handleUnfreezeColumns,
      handleLocalCellFilter,
      handleDatabaseCellFilter,
      handleClearLocalColumnFilter,
      handleForeignKeyNavigation,
      handleCloneRows,
      handleSetCellNull,
      handleSortAsc,
      handleSortDesc,
      isEditable,
      contextColumnAllowsNull,
      onCopy,
      selectedRowIndexes.length,
      columns.length,
      hiddenColumns.length,
      frozenColumnCount,
      contextMenu.col,
      contextMenu.columnId,
      contextCellValue,
      contextValueLabel,
      contextSourceRowIndex,
      onEditDocument,
      onCloneDocument,
      onDeleteDocument,
      closeContextMenu,
      contextForeignKeyPlans,
    ]);

    // Draw borders after cells are rendered

    const { mode } = useTheme();
    const gridFontSize = viewMetrics.fontSize;
    // Keep the canvas palette aligned with the workbench CSS tokens.
    const gridTheme: Partial<Theme> = useMemo(
      () => ({
        accentColor: cssHslVar(
          "--wb-accent",
          mode === "dark" ? "#75a7ff" : "#2f65d7",
        ),
        accentLight: cssHslVarAlpha(
          "--wb-accent",
          mode === "dark" ? 0.24 : 0.16,
          mode === "dark"
            ? "rgba(91, 137, 214, 0.24)"
            : "rgba(47, 101, 215, 0.16)",
        ),

        bgCell: cssHslVar("--wb-grid", mode === "dark" ? "#1e1f22" : "#ffffff"),
        bgCellMedium: cssHslVar(
          "--wb-editor",
          mode === "dark" ? "#1f2125" : "#f5f7fb",
        ),

        bgHeader: cssHslVar(
          "--wb-grid-header",
          mode === "dark" ? "#24272d" : "#eef2f8",
        ),
        bgHeaderHasFocus: cssHslVarAlpha(
          "--wb-active-strong",
          mode === "dark" ? 0.88 : 0.82,
          mode === "dark" ? "#2d3a56" : "#dfe8f7",
        ),
        bgHeaderHovered: cssHslVar(
          "--wb-hover",
          mode === "dark" ? "#303846" : "#d8e3f5",
        ),

        textHeader: cssHslVar(
          "--wb-text-muted",
          mode === "dark" ? "#aeb7c8" : "#4b5565",
        ),
        textGroupHeader: cssHslVar(
          "--wb-text-muted",
          mode === "dark" ? "#828b9b" : "#7a8393",
        ),
        textDark: cssHslVar(
          "--wb-text",
          mode === "dark" ? "#d9dee8" : "#111827",
        ),
        textMedium: cssHslVar(
          "--wb-text-muted",
          mode === "dark" ? "#a7afbd" : "#596274",
        ),
        textLight: cssHslVarAlpha(
          "--wb-text-muted",
          mode === "dark" ? 0.72 : 0.78,
          mode === "dark" ? "#7a8393" : "#8a93a3",
        ),
        textBubble: cssHslVar(
          "--wb-text",
          mode === "dark" ? "#d9dee8" : "#111827",
        ),

        borderColor: cssHslVar(
          "--wb-border-subtle",
          mode === "dark" ? "#343943" : "#dce3ee",
        ),
        drilldownBorder: cssHslVar(
          "--wb-border-subtle",
          mode === "dark" ? "#343943" : "#dce3ee",
        ),

        linkColor: cssHslVar(
          "--wb-accent",
          mode === "dark" ? "#75a7ff" : "#2f65d7",
        ),

        headerFontStyle: `600 ${gridFontSize}px`,
        baseFontStyle: `${gridFontSize}px`,
        fontFamily: "Inter, system-ui, sans-serif",
        editorFontSize: `${gridFontSize}px`,
        lineHeight: 1.45,

        bgIconHeader: cssHslVar(
          "--wb-editor",
          mode === "dark" ? "#202328" : "#f7f9fc",
        ),
        fgIconHeader: cssHslVar(
          "--wb-text-muted",
          mode === "dark" ? "#aeb7c8" : "#596274",
        ),
        bgBubble: cssHslVar(
          "--wb-panel-raised",
          mode === "dark" ? "#1e1f22" : "#ffffff",
        ),
        bgBubbleSelected: "transparent",

        cellHorizontalPadding: Math.max(8, Math.round(10 * gridScale)),
        cellVerticalPadding: Math.max(4, Math.round(5 * gridScale)),
      }),
      [gridFontSize, gridScale, mode],
    );

    if (error && errorPresentation) {
      return (
        <div
          role="alert"
          className="flex h-full items-center justify-center overflow-auto px-6 py-8"
        >
          <div className="w-full max-w-[560px] rounded-[6px] border border-[hsl(var(--destructive)/0.28)] bg-[hsl(var(--destructive)/0.06)] px-5 py-4">
            <div className="flex items-start gap-3">
              <CircleAlert
                size={18}
                className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
                  {errorPresentation.title}
                </h3>
                <p className="mt-1 text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
                  {errorPresentation.description}
                </p>
                {errorPresentation.metadata.length > 0 && (
                  <dl className="mt-2 flex flex-wrap gap-1.5">
                    {errorPresentation.metadata.map((item) => (
                      <div
                        key={`${item.label}:${item.value}`}
                        className="inline-flex min-w-0 items-center gap-1 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        <dt className="text-[hsl(var(--wb-text-muted))]">
                          {item.label}
                        </dt>
                        <dd className="max-w-[260px] truncate text-[hsl(var(--wb-text))]">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {errorPresentation.suggestion && (
                  <p className="mt-2 text-[12px] leading-5 text-[hsl(var(--wb-text))]">
                    {errorPresentation.suggestion}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {activeTab?.type === "query" &&
                    activeTab.queryError?.database && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 rounded-[4px] px-2.5 text-[11px]"
                        onClick={() => {
                          queueQueryErrorFix(
                            activeTab.id,
                            activeTab.queryError!,
                          );
                          window.dispatchEvent(
                            new CustomEvent(APP_EVENT_OPEN_ASSISTANT),
                          );
                        }}
                      >
                        <Sparkles size={12} aria-hidden="true" />
                        Ask AI to fix
                      </Button>
                    )}
                  {errorPresentation.retryable &&
                    activeTab?.connectionId && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1.5 rounded-[4px] px-2.5 text-[11px]"
                        disabled={activeTab.isExecuting}
                        onClick={() =>
                          void runTabQuery(
                            activeTab.id,
                            activeTab.connectionId!,
                          )
                        }
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        Run query again
                      </Button>
                    )}
                </div>
                {errorPresentation.technicalDetails && (
                  <details className="mt-3 text-[11px] text-[hsl(var(--wb-text-muted))]">
                    <summary className="cursor-pointer select-none hover:text-[hsl(var(--wb-text))]">
                      Technical details
                    </summary>
                    <code className="mt-2 block [overflow-wrap:anywhere] rounded-[4px] bg-[hsl(var(--wb-editor))] px-2.5 py-2 font-mono leading-4">
                      {errorPresentation.technicalDetails}
                    </code>
                  </details>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="wb-data-grid flex h-full flex-col wb-grid-surface">
        {activeTab?.type !== "table" && result && (
          <div
            ref={queryToolbarRef}
            data-compact={queryToolbarCompact || undefined}
            className="h-9 shrink-0 overflow-hidden border-b wb-data-toolbar flex items-center gap-2 px-3"
          >
            <div className="shrink-0 text-xs text-muted-foreground">
              {isTransposed && sourceResult
                ? `${sourceResult.columns.length.toLocaleString()} fields × ${sourceResult.rows.length.toLocaleString()} rows`
                : `${result.truncated ? "First " : ""}${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? "" : "s"}`}
            </div>
            {result.truncated && (
              <div
                className="flex min-w-0 items-center gap-1 text-[10px] text-[hsl(var(--wb-accent))]"
                role="status"
                title={`Result limited to ${(result.rowLimit || result.rows.length).toLocaleString()} rows. Add a LIMIT clause or narrow the query to retrieve a smaller, complete result.`}
              >
                <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
                {!queryToolbarCompact && (
                  <span className="truncate">Result truncated</span>
                )}
              </div>
            )}
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={!sourceResult || sourceResult.rows.length === 0}
              onClick={() => setQueryResultTransposed((current) => !current)}
              title={
                isTransposed
                  ? "Show standard result grid"
                  : "Transpose rows and columns"
              }
              aria-pressed={isTransposed}
              aria-label={isTransposed ? "Show standard result grid" : "Transpose result"}
            >
              <Rows3
                size={14}
                className={queryToolbarCompact ? undefined : "mr-1.5"}
              />
              {!queryToolbarCompact && (isTransposed ? "Standard" : "Transpose")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={result.rows.length === 0}
              onClick={() => void handleCopyAll()}
              title="Copy result as TSV"
              aria-label="Copy result as TSV"
            >
              <Copy
                size={14}
                className={queryToolbarCompact ? undefined : "mr-1.5"}
              />
              {!queryToolbarCompact && "Copy"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={result.rows.length === 0}
                  title="Export query result"
                  aria-label="Export query result"
                >
                  <Download
                    size={14}
                    className={queryToolbarCompact ? undefined : "mr-1.5"}
                  />
                  {!queryToolbarCompact && "Export"}
                  <ChevronDown size={11} className="ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="wb-menu-content min-w-52">
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("csv", "csv")}
                >
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                  CSV (UTF-8)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("csvBom", "csv")}
                >
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                  CSV (UTF-8 BOM / Excel)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("json", "json")}
                >
                  <FileJson className="mr-2 h-3.5 w-3.5" />
                  JSON array
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("jsonl", "jsonl")}
                >
                  <FileJson className="mr-2 h-3.5 w-3.5" />
                  JSON Lines (JSONL)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("markdown", "md")}
                >
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  Markdown table
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("tsv", "tsv")}
                >
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                  TSV (Excel)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="wb-menu-item"
                  onSelect={() => handleExport("sql", "sql")}
                >
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  SQL INSERT template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* DataEditor container with overlay */}
        <div
          ref={gridContainerRef}
          className="flex-1 overflow-hidden relative"
          aria-busy={activeTab?.isExecuting || undefined}
        >
          {!result && (!overrideColumns || overrideColumns.length === 0) ? (
            !activeTab?.isExecuting && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                {activeTab?.type === "table"
                  ? "No data loaded"
                  : "Run a query to see results"}
              </div>
            )
          ) : (
            <>
              <DataEditor
                ref={dataEditorRef}
                getCellContent={getCellContent}
                columns={columns}
                freezeColumns={frozenColumnCount}
                rows={visualRows.length}
                onHeaderMenuClick={isTransposed ? undefined : onHeaderMenuClick}
                onHeaderContextMenu={isTransposed ? undefined : onHeaderContextMenu}
                onCellContextMenu={isTransposed ? undefined : onCellContextMenu}
                onItemHovered={onItemHovered}
                onCellEdited={isEditable ? onCellEdited : undefined}
                onCellsEdited={isEditable ? onCellsEdited : undefined}
                onPaste={isEditable ? onPaste : undefined}
                onCellActivated={onCellActivated}
                onKeyDown={onGridKeyDown}
                onColumnResize={isTransposed ? undefined : onColumnResize}
                onColumnMoved={isTransposed ? undefined : onColumnMoved}
                smoothScrollX
                smoothScrollY
                width="100%"
                height="100%"
                theme={gridTheme}
                rowHeight={viewMetrics.rowHeight}
                headerHeight={viewMetrics.headerHeight}
                rowMarkerWidth={viewMetrics.rowMarkerWidth}
                getCellsForSelection={true}
                rowMarkers="clickable-number"
                rowMarkerStartIndex={1}
                gridSelection={gridSelection}
                onGridSelectionChange={setGridSelection}
                keybindings={{ search: true }}
                experimental={{ scrollbarWidthOverride: 10 }}
                showSearch={showSearch}
                onSearchClose={() => setShowSearch(false)}
              />
              {columnLookupOpen && (
                <div
                  className="absolute right-3 top-3 z-20 w-72 overflow-hidden rounded-md border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface-raised))] shadow-xl animate-in fade-in-0 zoom-in-95"
                  role="dialog"
                  aria-label="Go to column"
                >
                  <div className="border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
                    <input
                      ref={columnLookupInputRef}
                      value={columnLookupQuery}
                      onChange={(event) => setColumnLookupQuery(event.target.value)}
                      onKeyDown={onColumnLookupKeyDown}
                      placeholder="Go to column…"
                      aria-label="Search columns"
                      className="h-7 w-full rounded border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] px-2 text-xs outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto p-1" role="listbox" aria-label="Matching columns">
                    {filteredColumnLookupItems.length === 0 ? (
                      <p className="px-2 py-3 text-center text-xs text-[hsl(var(--wb-text-muted))]">
                        No matching column
                      </p>
                    ) : (
                      filteredColumnLookupItems.map((item, index) => (
                        <button
                          key={`${item.index}:${item.name}`}
                          id={`grid-column-lookup-${item.index}`}
                          type="button"
                          role="option"
                          aria-selected={index === columnLookupSelectedIndex}
                          onMouseMove={() => setColumnLookupSelectedIndex(index)}
                          onClick={() => selectColumnLookupItem(item)}
                          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            index === columnLookupSelectedIndex
                              ? "bg-[hsl(var(--wb-accent)/0.18)] text-[hsl(var(--wb-text))]"
                              : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-surface-hover))] hover:text-[hsl(var(--wb-text))]"
                          }`}
                        >
                          <span className="min-w-0 truncate font-medium">{item.name}</span>
                          <span className="font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">#{item.index + 1}</span>
                          {item.detail && (
                            <span className="col-span-2 min-w-0 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                              {item.detail}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              {visualRows.length === 0 && (
                <div className="absolute inset-x-0 top-12 bottom-0 flex items-center justify-center pointer-events-none">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                    <span className="text-sm">
                      {result?.message || "No rows returned"}
                    </span>
                  </div>
                </div>
              )}
              {selectionAggregate && (
                <SelectionAggregateBar aggregate={selectionAggregate} />
              )}
            </>
          )}

          {contextMenu.type && (
            <DataGridContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={contextMenuItems}
              onClose={closeContextMenu}
            />
          )}

          <DataGridHoverTooltip tooltip={hoverTooltip} />

          {activeTab?.isExecuting && (
            <DataGridBusyIndicator
              kind={activeTab.type === "table" ? "table" : "query"}
            />
          )}
        </div>
        <ValueEditorDialog
          open={valueEditorTarget !== null}
          target={valueEditorTarget}
          onOpenChange={(open) => {
            if (!open) setValueEditorTarget(null);
          }}
          onStageValue={(value) => {
            if (!valueEditorTarget) return;
            setCellEdit(
              valueEditorTarget.tabId,
              valueEditorTarget.rowIndex,
              valueEditorTarget.columnIndex,
              value,
            );
          }}
          navigation={valueEditorNavigation}
          onNavigate={navigateValueEditor}
        />
      </div>
    );
  },
);
