import type { FilterOperator } from "@/components/workspace/GridFilterRow";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { DataGridContextMenuItem } from "@/features/data-grid/ui/DataGridContextMenu";
import type { QueryResultGridState } from "@/features/workspace-tabs/model/types";
import type { ForeignKeyNavigationPlan } from "@/lib/foreignKeyNavigation";
import { foreignKeyNavigationLabel } from "@/lib/foreignKeyNavigation";
import type { GridColumn, GridSelection } from "@glideapps/glide-data-grid";

import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowUpRight,
  CircleSlash2,
  Copy,
  Database,
  Eye,
  EyeOff,
  Pin,
  PinOff,
  RotateCcw,
  Rows3,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";

interface GridContextMenuItemsOptions {
  contextMenu: {
    type: "cell" | "header" | null;
    x: number;
    y: number;
    col?: number | undefined;
    row?: number | undefined;
    columnId?: string | undefined;
    columnName?: string | undefined;
  };
  handleCopyColumnName: () => void;
  formatterKeysForResultColumn: (columnIndex: number) => string[];
  visualColumnIndexToResultIndex: (visualColumnIndex: number) => number;
  handleOpenColumnFormatter: () => void;
  handleSortAsc: () => void;
  handleSortDesc: () => void;
  gridState: QueryResultGridState | undefined;
  handleClearSort: () => void;
  handleOpenColumnFilter: () => void;
  columns: GridColumn[];
  handleHideColumn: () => void;
  hiddenColumns: string[];
  handleShowAllColumns: () => void;
  frozenColumnCount: number;
  handleFreezeThroughColumn: () => void;
  handleUnfreezeColumns: () => void;
  handleOpenValueEditor: () => void;
  onCopy: (selection: GridSelection) => Promise<void>;
  gridSelection: GridSelection;
  contextValueLabel: string;
  handleLocalCellFilter: (
    operator:
      | "equals"
      | "contains"
      | "notEquals"
      | "notContains"
      | "isNull"
      | "isNotNull",
  ) => void;
  contextCellValue: unknown;
  handleClearLocalColumnFilter: () => void;
  activeTab: GridTabSnapshot | null;
  handleDatabaseCellFilter: (operator: FilterOperator) => Promise<void>;
  contextForeignKeyPlans: ForeignKeyNavigationPlan[];
  handleForeignKeyNavigation: (plan: ForeignKeyNavigationPlan) => Promise<void>;
  contextSourceRowIndex: number | undefined;
  onEditDocument: ((sourceRowIndex: number) => void) | undefined;
  onCloneDocument: ((sourceRowIndex: number) => void) | undefined;
  onDeleteDocument: ((sourceRowIndex: number) => void) | undefined;
  closeContextMenu: () => void;
  selectedRowIndexes: number[];
  isEditable: boolean;
  handleCloneRows: () => void;
  contextColumnAllowsNull: boolean;
  handleSetCellNull: () => void;
  handleDeleteSelectedRows: () => Promise<void>;
}

export function useGridContextMenuItems({
  contextMenu,
  handleCopyColumnName,
  formatterKeysForResultColumn,
  visualColumnIndexToResultIndex,
  handleOpenColumnFormatter,
  handleSortAsc,
  handleSortDesc,
  gridState,
  handleClearSort,
  handleOpenColumnFilter,
  columns,
  handleHideColumn,
  hiddenColumns,
  handleShowAllColumns,
  frozenColumnCount,
  handleFreezeThroughColumn,
  handleUnfreezeColumns,
  handleOpenValueEditor,
  onCopy,
  gridSelection,
  contextValueLabel,
  handleLocalCellFilter,
  contextCellValue,
  handleClearLocalColumnFilter,
  activeTab,
  handleDatabaseCellFilter,
  contextForeignKeyPlans,
  handleForeignKeyNavigation,
  contextSourceRowIndex,
  onEditDocument,
  onCloneDocument,
  onDeleteDocument,
  closeContextMenu,
  selectedRowIndexes,
  isEditable,
  handleCloneRows,
  contextColumnAllowsNull,
  handleSetCellNull,
  handleDeleteSelectedRows,
}: GridContextMenuItemsOptions) {
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
          id: "format-column",
          label: "Format Column...",
          description:
            "Change display formatting without changing stored values.",
          icon: <Sparkles size={12} />,
          disabled:
            contextMenu.col === undefined ||
            formatterKeysForResultColumn(
              visualColumnIndexToResultIndex(contextMenu.col),
            ).length === 0,
          onSelect: handleOpenColumnFormatter,
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
          description:
            "Keep this and preceding columns visible while scrolling.",
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
                    onSelect: () => void handleDatabaseCellFilter("equals"),
                  },
                  {
                    id: "filter-database-contains",
                    label: `Contains ${contextValueLabel}`,
                    onSelect: () => void handleDatabaseCellFilter("contains"),
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
                      description:
                        "Create a reviewed copy with a new identity.",
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
    handleOpenColumnFormatter,
    formatterKeysForResultColumn,
    visualColumnIndexToResultIndex,
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

  return { contextMenuItems };
}
