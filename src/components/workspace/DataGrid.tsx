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
  type GridKeyEventArgs,
  type HeaderClickedEventArgs,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { useTabStore } from "@/store/useTabStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTheme } from "@/theme/useTheme";
import { createTypedCell, applyFilter, compareValues } from "@/lib/gridUtils";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileJson,
  RotateCcw,
  Rows3,
  Search,
  CircleSlash2,
  SquarePen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnFilter } from "./GridFilterRow";
import {
  DataGridContextMenu,
  type DataGridContextMenuItem,
} from "./DataGridContextMenu";
import {
  exportToCsv,
  exportToJson,
  serializeQueryResultSelectionToTsv,
} from "@/lib/exportUtils";
import { dataGridMetrics } from "@/lib/dataGridView";
import { DataGridBusyIndicator } from "./DataGridBusyIndicator";
import {
  resultColumnGridId,
  resultColumnIndexByGridId,
} from "@/lib/gridColumns";
import { ValueEditorDialog, type ValueEditorTarget } from "./ValueEditorDialog";
import type {
  ConstraintInfo,
  ForeignKeyReferenceInfo,
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

interface GridValueEditorTarget extends ValueEditorTarget {
  tabId: string;
  rowIndex: number;
  columnIndex: number;
}

const EMPTY_PENDING_EDITS = new Map<string, unknown>();

export interface DataGridHandle {
  openSearch: () => void;
  fitColumns: () => void;
  deleteSelectedRows: () => Promise<void>;
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
}

function rangeIndexes(start: number, length: number) {
  return Array.from({ length }, (_, index) => start + index);
}

function exportFilename(title: string | undefined, extension: "csv" | "json") {
  const safeTitle = (title || "query-result")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeTitle || "query-result"}.${extension}`;
}

function columnIconForType(type: string, isPrimaryKey?: boolean) {
  if (isPrimaryKey) return GridColumnIcon.HeaderRowID;

  const normalized = type.toLowerCase();
  if (
    /\b(int|serial|decimal|numeric|real|double|float|money)\b/.test(normalized)
  ) {
    return GridColumnIcon.HeaderNumber;
  }
  if (/\b(bool|boolean|bit)\b/.test(normalized)) {
    return GridColumnIcon.HeaderBoolean;
  }
  if (/\b(timestamp|datetime|date)\b/.test(normalized)) {
    return GridColumnIcon.HeaderDate;
  }
  if (/\btime\b/.test(normalized)) {
    return GridColumnIcon.HeaderTime;
  }
  if (/\b(json|jsonb|xml|object|map)\b/.test(normalized)) {
    return GridColumnIcon.HeaderCode;
  }
  if (/\[\]|\b(array|list|set)\b/.test(normalized)) {
    return GridColumnIcon.HeaderArray;
  }
  if (/\b(uuid|foreign|reference)\b/.test(normalized)) {
    return GridColumnIcon.HeaderReference;
  }
  return GridColumnIcon.HeaderString;
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
    },
    ref,
  ) {
    const {
      tabs,
      activeTabId,
      setGridFilter,
      setGridSort,
      setCellEdit,
      setBulkCellEdit,
      setColumnWidth,
      setColumnOrder,
      setColumnHidden,
      showAllColumns,
      deleteRows,
      findOrCreateTableTab,
      loadTablePage,
      setFilterMode,
      setVisualFilters,
      setSqlFilter,
    } = useTabStore();
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
    const activeTab = tabs.find((t) => t.id === activeTabId);

    const resultIndex = activeTab?.activeResultIndex ?? 0;
    const result = activeTab?.results?.[resultIndex] ?? activeTab?.results?.[0];
    const error = activeTab?.error;
    const gridState = activeTab?.gridState;
    const pendingEdits = activeTab?.pendingEdits || EMPTY_PENDING_EDITS;
    const isEditable = activeTab?.type === "table" && !readOnly;
    const columnWidths = activeTab?.columnWidths || {};
    const columnOrder = activeTab?.columnOrder || [];
    const hiddenColumns = activeTab?.hiddenColumns || [];
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

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const dataEditorRef = useRef<DataEditorRef>(null);

    const tableColumns = activeTab?.tableColumns;

    useEffect(() => {
      setValueEditorTarget(null);
      setGridSelection({
        columns: CompactSelection.empty(),
        rows: CompactSelection.empty(),
      });
      setContextMenu({ type: null, x: 0, y: 0 });
    }, [activeTabId, resultIndex]);

    // Column definitions
    const columns = useMemo<GridColumn[]>(() => {
      // If we have a result, use its columns
      if (result && result.columns.length > 0) {
        const allColumns = result.columns
          .map((col, index) => {
            const columnId = resultColumnGridId(result.columns, index);
            const isSorted = gridState?.sortColumn === columnId;
            const sortDir = gridState?.sortDirection;
            const customWidth =
              columnWidths[columnId] ?? columnWidths[col.name];

            let title = col.name || "Unknown";
            let columnIcon: GridColumnIcon | undefined;
            if (tableColumns) {
              try {
                const meta = tableColumns.find((c) => c.name === col.name);
                if (meta) {
                  let type = meta.data_type || "text";
                  if (type === "character varying") type = "varchar";
                  if (type === "timestamp without time zone")
                    type = "timestamp";

                  title = `${col.name} (${type})`;
                  columnIcon = columnIconForType(type, meta.is_primary_key);
                }
              } catch (e) {
                console.error("DataGrid: Error generating column header", e);
              }
            }

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
    ]);

    // Apply filters and sorting
    const { filteredRows, sortedIndices } = useMemo(() => {
      if (!result) return { filteredRows: [], sortedIndices: [] };

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
          indices.sort((a, b) => {
            const valA = result.rows[a]?.[colIndex];
            const valB = result.rows[b]?.[colIndex];
            return compareValues(valA, valB, gridState.sortDirection!);
          });
        }
      }

      return {
        filteredRows: indices.map((i) => result.rows[i]),
        sortedIndices: indices,
      };
    }, [result, gridState, globalFilter, columnFilters, activeTab?.type]);

    const selectedRowIndexes = useMemo(
      () =>
        gridSelection.rows
          .toArray()
          .map((row) => sortedIndices[row])
          .filter((rowIndex): rowIndex is number => rowIndex !== undefined),
      [gridSelection.rows, sortedIndices],
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
            ? resultColumnIndexByGridId(result.columns, visualColumn.id)
            : -1;
          const resultColumn = result?.columns[originalColumnIndex];
          return {
            originalColumnIndex,
            dataType:
              resultColumn?.data_type ||
              tableColumns?.find(
                (columnInfo) => columnInfo.name === resultColumn?.name,
              )?.data_type,
          };
        }),
      [columns, result, tableColumns],
    );

    const selectionAggregate = useMemo(() => {
      if (
        !result ||
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
        rowCount: filteredRows.length + newRowsCount,
        columnCount: columns.length,
      });
      if (selection.coordinates.length <= 1) return null;

      const cells = selection.coordinates.map(([row, column]) => {
        const columnMetadata = aggregateColumnMetadata[column];
        if (!columnMetadata) return { value: undefined };
        const { originalColumnIndex } = columnMetadata;
        if (originalColumnIndex < 0) return { value: undefined };

        const isNewRow = row >= filteredRows.length;
        const rowKey = isNewRow
          ? -1 - (row - filteredRows.length)
          : sortedIndices[row];
        if (rowKey === undefined) return { value: undefined };
        const editKey = `${rowKey}:${originalColumnIndex}`;
        const value = pendingEdits.has(editKey)
          ? pendingEdits.get(editKey)
          : isNewRow
            ? undefined
            : result.rows[rowKey]?.[originalColumnIndex];

        return {
          value,
          dataType: columnMetadata.dataType,
        };
      });

      return summarizeSelection(cells, selection.truncated);
    }, [
      columns,
      activeTabId,
      aggregateColumnMetadata,
      deferredGridSelectionContext,
      filteredRows.length,
      newRowsCount,
      pendingEdits,
      result,
      resultIndex,
      sortedIndices,
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

        // Check if it's a new row
        const isNewRow = row >= filteredRows.length;

        // Determine the "Row Key" for editing/retrieval
        let editRowKey: number;
        let actualRowIndex: number | undefined;

        if (isNewRow) {
          const newRowOffset = row - filteredRows.length;
          editRowKey = -1 - newRowOffset; // -1, -2, -3...
          actualRowIndex = undefined;
        } else {
          actualRowIndex = sortedIndices[row];
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
          originalColIndex = resultColumnIndexByGridId(
            result.columns,
            visualColumn.id,
          );
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

        const baseCell = createTypedCell(
          val,
          isEditable,
          isNewRow ? "DEFAULT" : "NOT LOADED",
        );
        const gridCell = { ...baseCell };

        // Force editable for compatible types
        if (gridCell.kind !== GridCellKind.Boolean) {
          (gridCell as any).allowOverlay = isEditable;
          (gridCell as any).readonly = !isEditable;
        }

        // Apply theme override for new rows
        if (isNewRow) {
          gridCell.themeOverride = {
            bgCell: "rgba(34, 197, 94, 0.1)", // Green tint
          };
        }

        return gridCell;
      },
      [
        result,
        filteredRows,
        sortedIndices,
        pendingEdits,
        columns,
        overrideColumns,
        isEditable,
      ],
    );

    // Handle header menu/arrow click for sorting
    // 'col' is visual index
    const onHeaderMenuClick = useCallback(
      (
        col: number,
        _bounds: { x: number; y: number; width: number; height: number },
      ) => {
        if (!activeTab || !result) return;

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
      [activeTab, result, gridState, setGridSort, columns],
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
          let actualRowKey: number | undefined;
          if (r >= filteredRows.length) {
            actualRowKey = -1 - (r - filteredRows.length);
          } else {
            actualRowKey = sortedIndices[r];
          }

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
          return { rowIndex: actualRowKey, colIndex: origColIdx };
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
                  edits.push({ ...indices, value });
                }
              }
            }
          }
        }

        if (!appliedToSelection) {
          const indices = getIndices(row, col);
          if (indices) edits.push({ ...indices, value });
        }

        if (edits.length > 0) {
          const firstEdit = edits[0];
          if (edits.length === 1 && firstEdit) {
            setCellEdit(
              activeTab.id,
              firstEdit.rowIndex,
              firstEdit.colIndex,
              value,
            );
          } else {
            setBulkCellEdit(activeTab.id, edits);
          }
        }
      },
      [
        activeTab,
        result,
        sortedIndices,
        setCellEdit,
        setBulkCellEdit,
        columns,
        filteredRows,
        overrideColumns,
        gridSelection,
        isEditable,
      ],
    );

    // Column resize handler
    const onColumnResize = useCallback(
      (column: GridColumn, newSize: number) => {
        if (!activeTab || !column.id) return;
        setColumnWidth(
          activeTab.id,
          column.id,
          Math.round(newSize / gridScale),
        );
      },
      [activeTab, gridScale, setColumnWidth],
    );

    // Column move handler
    const onColumnMoved = useCallback(
      (startIndex: number, endIndex: number) => {
        if (!activeTab) return;

        const newOrder = [...columns]
          .map((c) => c.id || "")
          .filter(Boolean) as string[];
        const [moved] = newOrder.splice(startIndex, 1);
        if (moved) {
          newOrder.splice(endIndex, 0, moved);
          setColumnOrder(activeTab.id, newOrder);
        }
      },
      [activeTab, columns, setColumnOrder],
    );

    const visualColumnIndexToResultIndex = useCallback(
      (visualColumnIndex: number) => {
        const visualColumn = columns[visualColumnIndex];
        if (!visualColumn) return -1;
        if (result) {
          return resultColumnIndexByGridId(result.columns, visualColumn.id);
        }
        return (
          overrideColumns?.findIndex(
            (column) => column.name === visualColumn.id,
          ) ?? -1
        );
      },
      [columns, overrideColumns, result],
    );

    const openValueEditor = useCallback(
      (cell: Item) => {
        if (!activeTab) return;
        const [visualColumnIndex, visualRowIndex] = cell;
        const columnIndex = visualColumnIndexToResultIndex(visualColumnIndex);
        if (columnIndex < 0) return;

        const isNewRow = visualRowIndex >= filteredRows.length;
        const rowIndex = isNewRow
          ? -1 - (visualRowIndex - filteredRows.length)
          : sortedIndices[visualRowIndex];
        if (rowIndex === undefined) return;

        const resultColumn = result?.columns[columnIndex];
        const fallbackColumn = overrideColumns?.[columnIndex];
        const columnName = resultColumn?.name || fallbackColumn?.name;
        if (!columnName) return;
        const metadata = tableColumns?.find(
          (column) => column.name === columnName,
        );
        const editKey = `${rowIndex}:${columnIndex}`;
        const pending = pendingEdits.has(editKey);
        const originalValue =
          rowIndex >= 0 ? result?.rows[rowIndex]?.[columnIndex] : undefined;
        const value = pending ? pendingEdits.get(editKey) : originalValue;
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
          editable: isEditable && !activeTab.isExecuting,
          nullable: metadata?.is_nullable !== false,
          pending,
          defaultValue: metadata?.default_value,
        });
      },
      [
        activeTab,
        filteredRows.length,
        isEditable,
        overrideColumns,
        pendingEdits,
        result,
        sortedIndices,
        tableColumns,
        visualColumnIndexToResultIndex,
      ],
    );

    const onGridKeyDown = useCallback(
      (event: GridKeyEventArgs) => {
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
      [openValueEditor],
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
      );

      try {
        await navigator.clipboard.writeText(text);
        console.log("Copied query result to clipboard");
      } catch (err) {
        console.error("Failed to copy query result:", err);
      }
    }, [copyIncludeHeaders, result]);

    const handleExportCsv = useCallback(() => {
      if (!result) return;
      exportToCsv(result, exportFilename(activeTab?.title, "csv"));
    }, [activeTab?.title, result]);

    const handleExportJson = useCallback(() => {
      if (!result) return;
      exportToJson(result, exportFilename(activeTab?.title, "json"));
    }, [activeTab?.title, result]);

    // Copy selected cells to clipboard
    const onCopy = useCallback(
      async (selection: GridSelection) => {
        if (!result) return;

        const range = selection.current?.range;
        let visualRows = selection.rows.toArray();
        let visualColumns = selection.columns.toArray();

        if (visualRows.length === 0 && range) {
          visualRows = rangeIndexes(range.y, range.height);
        }
        if (visualColumns.length === 0 && range) {
          visualColumns = rangeIndexes(range.x, range.width);
        }
        if (visualRows.length === 0 && visualColumns.length > 0) {
          visualRows = filteredRows.map((_, index) => index);
        }

        const rowIndexes = visualRows
          .map((row) => sortedIndices[row] ?? row)
          .filter((rowIndex) => rowIndex >= 0 && rowIndex < result.rows.length);
        const columnIndexes =
          visualColumns.length > 0
            ? visualColumns
                .map(visualColumnIndexToResultIndex)
                .filter((columnIndex) => columnIndex >= 0)
            : result.columns.map((_, index) => index);
        const text = serializeQueryResultSelectionToTsv(
          result,
          rowIndexes,
          columnIndexes,
          copyIncludeHeaders,
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
        copyIncludeHeaders,
        filteredRows,
        result,
        sortedIndices,
        visualColumnIndexToResultIndex,
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
        if (!result && (!overrideColumns || overrideColumns.length === 0)) {
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
        visualColumnIndexToResultIndex,
      ],
    );

    const onHeaderContextMenu = useCallback(
      (col: number, event: HeaderClickedEventArgs) => {
        if (!result) return;
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
      [columns, menuPosition, result],
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
      setColumnHidden(activeTab.id, contextMenu.columnId, true);
      closeContextMenu();
    }, [
      activeTab,
      closeContextMenu,
      columns.length,
      contextMenu.columnId,
      setColumnHidden,
    ]);

    const handleShowAllColumns = useCallback(() => {
      if (!activeTab) return;
      showAllColumns(activeTab.id);
      closeContextMenu();
    }, [activeTab, closeContextMenu, showAllColumns]);

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
        fitColumns: () => {
          if (columns.length === 0) return;
          dataEditorRef.current?.remeasureColumns(
            CompactSelection.fromSingleSelection([0, columns.length]),
          );
        },
        deleteSelectedRows: handleDeleteSelectedRows,
      }),
      [columns.length, handleDeleteSelectedRows],
    );

    const handleQuickFilter = useCallback(() => {
      if (
        !activeTab ||
        !result ||
        !contextMenu.columnId ||
        contextMenu.col === undefined ||
        contextMenu.row === undefined
      ) {
        return;
      }
      const resultColumnIndex = visualColumnIndexToResultIndex(contextMenu.col);
      const resultRowIndex = sortedIndices[contextMenu.row];
      if (resultColumnIndex < 0 || resultRowIndex === undefined) return;

      const value = result.rows[resultRowIndex]?.[resultColumnIndex];
      setGridFilter(activeTab.id, contextMenu.columnId, {
        operator: "equals",
        value: value === null ? "null" : String(value ?? ""),
      });
      closeContextMenu();
    }, [
      activeTab,
      closeContextMenu,
      contextMenu.col,
      contextMenu.columnId,
      contextMenu.row,
      result,
      setGridFilter,
      sortedIndices,
      visualColumnIndexToResultIndex,
    ]);

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
      const rowIndex =
        contextMenu.row >= filteredRows.length
          ? -1 - (contextMenu.row - filteredRows.length)
          : sortedIndices[contextMenu.row];
      if (colIndex < 0 || rowIndex === undefined) return;

      setCellEdit(activeTab.id, rowIndex, colIndex, null);
      closeContextMenu();
    }, [
      activeTab,
      closeContextMenu,
      contextMenu.col,
      contextMenu.row,
      filteredRows.length,
      isEditable,
      setCellEdit,
      sortedIndices,
      visualColumnIndexToResultIndex,
    ]);

    const contextColumnAllowsNull = useMemo(() => {
      if (!contextMenu.columnName || !tableColumns) return true;
      return (
        tableColumns.find((column) => column.name === contextMenu.columnName)
          ?.is_nullable !== false
      );
    }, [contextMenu.columnName, tableColumns]);

    const contextForeignKeyPlans = useMemo(() => {
      if (
        activeTab?.type !== "table" ||
        !activeTab.schemaName ||
        !activeTab.tableName ||
        !result ||
        !contextMenu.columnName ||
        contextMenu.row === undefined ||
        contextMenu.row >= filteredRows.length
      ) {
        return [];
      }

      const resultRowIndex = sortedIndices[contextMenu.row];
      if (resultRowIndex === undefined) return [];
      const resultRow = result.rows[resultRowIndex];
      if (!resultRow) return [];

      const rowWithDrafts = resultRow.map(
        (value: unknown, columnIndex: number) => {
          const key = `${resultRowIndex}:${columnIndex}`;
          return pendingEdits.has(key) ? pendingEdits.get(key) : value;
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
      filteredRows.length,
      pendingEdits,
      referencingForeignKeys,
      result,
      sortedIndices,
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
            icon: <Copy size={12} />,
            onSelect: handleCopyColumnName,
          },
          {
            id: "sort-ascending",
            label: "Sort Ascending",
            icon: <ArrowUpAZ size={12} />,
            separatorBefore: true,
            onSelect: handleSortAsc,
          },
          {
            id: "sort-descending",
            label: "Sort Descending",
            icon: <ArrowDownAZ size={12} />,
            onSelect: handleSortDesc,
          },
          {
            id: "clear-sort",
            label: "Clear Sort",
            icon: <RotateCcw size={12} />,
            disabled: !gridState?.sortColumn,
            onSelect: handleClearSort,
          },
          {
            id: "column-filter",
            label: "Set Column Filter...",
            icon: <Search size={12} />,
            separatorBefore: true,
            onSelect: handleOpenColumnFilter,
          },
          {
            id: "hide-column",
            label: "Hide Column",
            icon: <EyeOff size={12} />,
            disabled: columns.length <= 1,
            separatorBefore: true,
            onSelect: handleHideColumn,
          },
          {
            id: "show-all-columns",
            label: "Show All Columns",
            icon: <Eye size={12} />,
            disabled: hiddenColumns.length === 0,
            onSelect: handleShowAllColumns,
          },
        ];
      }
      if (contextMenu.type === "cell") {
        return [
          {
            id: "open-value-editor",
            label: "Open Value Editor...",
            icon: <SquarePen size={12} />,
            shortcut: "⇧↵",
            onSelect: handleOpenValueEditor,
          },
          {
            id: "copy-cell",
            label: "Copy",
            icon: <Copy size={12} />,
            shortcut: "⌘C",
            separatorBefore: true,
            onSelect: () => void onCopy(gridSelection),
          },
          {
            id: "filter-cell-value",
            label: "Filter by This Value",
            icon: <Search size={12} />,
            onSelect: handleQuickFilter,
          },
          ...contextForeignKeyPlans.map((plan, index) => ({
            id: `foreign-key-${plan.direction}-${plan.constraintName}-${index}`,
            label: foreignKeyNavigationLabel(plan),
            icon:
              plan.direction === "referenced" ? (
                <ArrowUpRight size={12} />
              ) : (
                <Rows3 size={12} />
              ),
            separatorBefore: index === 0,
            onSelect: () => void handleForeignKeyNavigation(plan),
          })),
          {
            id: "set-cell-null",
            label: "Set NULL",
            icon: <CircleSlash2 size={12} />,
            disabled: !isEditable || !contextColumnAllowsNull,
            separatorBefore: true,
            onSelect: handleSetCellNull,
          },
          {
            id: "delete-selected-rows",
            label: "Delete Selected Rows",
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
      gridSelection,
      gridState?.sortColumn,
      handleClearSort,
      handleCopyColumnName,
      handleDeleteSelectedRows,
      handleOpenColumnFilter,
      handleHideColumn,
      handleOpenValueEditor,
      handleShowAllColumns,
      handleQuickFilter,
      handleForeignKeyNavigation,
      handleSetCellNull,
      handleSortAsc,
      handleSortDesc,
      isEditable,
      contextColumnAllowsNull,
      onCopy,
      selectedRowIndexes.length,
      columns.length,
      hiddenColumns.length,
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

    if (error) {
      return (
        <div className="flex items-center justify-center h-full text-red-400 text-sm">
          Error: {error}
        </div>
      );
    }

    return (
      <div className="wb-data-grid flex h-full flex-col wb-grid-surface">
        {activeTab?.type !== "table" && result && (
          <div className="h-9 shrink-0 border-b wb-data-toolbar flex items-center gap-2 px-3">
            <div className="text-xs text-muted-foreground">
              {result.rows.length.toLocaleString()} row
              {result.rows.length === 1 ? "" : "s"}
            </div>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={result.rows.length === 0}
              onClick={() => void handleCopyAll()}
              title="Copy result as TSV"
            >
              <Copy size={14} className="mr-1.5" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={result.rows.length === 0}
              onClick={handleExportCsv}
              title="Export result as CSV"
            >
              <Download size={14} className="mr-1.5" />
              CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={result.rows.length === 0}
              onClick={handleExportJson}
              title="Export result as JSON"
            >
              <FileJson size={14} className="mr-1.5" />
              JSON
            </Button>
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
                Run a query to see results
              </div>
            )
          ) : (
            <>
              <DataEditor
                ref={dataEditorRef}
                getCellContent={getCellContent}
                columns={columns}
                rows={filteredRows.length + newRowsCount}
                onHeaderMenuClick={onHeaderMenuClick}
                onHeaderContextMenu={onHeaderContextMenu}
                onCellContextMenu={onCellContextMenu}
                onCellEdited={isEditable ? onCellEdited : undefined}
                onKeyDown={onGridKeyDown}
                onColumnResize={onColumnResize}
                onColumnMoved={onColumnMoved}
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
              {filteredRows.length === 0 && newRowsCount === 0 && (
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
        />
      </div>
    );
  },
);
