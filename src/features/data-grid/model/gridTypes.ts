import type { ColumnFilter } from "@/components/workspace/GridFilterRow";
import { type ValueEditorTarget } from "@/features/value-editor/model/valueEditorTypes";
import type {
  ConstraintInfo,
  ForeignKeyReferenceInfo,
  QueryResult,
} from "@/services/tauri/types";

export interface GridValueEditorTarget extends ValueEditorTarget {
  tabId: string;
  rowIndex: number;
  columnIndex: number;
}

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

export interface DataGridProps {
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

import type { TabData } from "@/features/workspace-tabs/model/types";
export type GridTabSnapshot = Pick<
  TabData,
  | "id"
  | "title"
  | "type"
  | "connectionId"
  | "databaseName"
  | "schemaName"
  | "tableName"
  | "queryLanguage"
  | "results"
  | "resultSql"
  | "nativeQueryHasMore"
  | "activeResultIndex"
  | "activeResultRunId"
  | "executingResultIndex"
  | "executingResultRunId"
  | "error"
  | "queryError"
  | "isExecuting"
  | "gridState"
  | "pendingEdits"
  | "newRowsCount"
  | "newRowPlacements"
  | "visualFilters"
  | "columnWidths"
  | "columnOrder"
  | "hiddenColumns"
  | "frozenColumnCount"
  | "tableColumns"
  | "tablePage"
  | "tablePageSize"
>;
