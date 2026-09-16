import { type DataGridHandle } from "@/components/workspace/DataGrid";
import type { FilterOperator } from "@/components/workspace/GridFilterRow";
import type {
  TabData,
  TablePageLoadOptions,
} from "@/features/workspace-tabs/model/types";
import type { QueryResult } from "@/services/tauri/types/query";
import type { TableFilter } from "@/services/tauri/types/tableRows";

interface TableNavigationOptions {
  activeTab: TabData;
  filterMode: "visual" | "sql";
  sqlFilter: string;
  loadTablePage: (
    tabId: string,
    page?: number | undefined,
    filterSql?: string | null | undefined,
    filters?: TableFilter[] | null | undefined,
    options?: TablePageLoadOptions | undefined,
  ) => Promise<boolean>;
  visualFilters: {
    column: string;
    operator: FilterOperator;
    value: string;
    logic?: "AND" | "OR" | undefined;
  }[];
  defaultPageSize: number;
  result: QueryResult | undefined;
  isSearchObjectPreview: boolean;
  loadDocumentPage: (
    tabId: string,
    page?: number | undefined,
    options?:
      | {
          filter?: string | null | undefined;
          sort?: string | null | undefined;
          discardAction?: string | undefined;
          discardDraftsConfirmed?: boolean | undefined;
        }
      | undefined,
  ) => Promise<boolean>;
  isNativeObjectPreview: boolean;
  tabConnectionId: string | null;
  runTabQuery: (
    id: string,
    connectionId: string,
    sqlOverride?: string | undefined,
    transactionId?: string | undefined,
    sourceStartOffset?: number | undefined,
  ) => Promise<void>;
  documentFilterDraft: string;
  documentSortDraft: string;
  setDocumentFilterDraft: React.Dispatch<React.SetStateAction<string>>;
  setDocumentSortDraft: React.Dispatch<React.SetStateAction<string>>;
  isMongoDocumentPreview: boolean;
  isTransposed: boolean;
  dataGridRef: React.RefObject<DataGridHandle | null>;
  setMongoDocumentAction: React.Dispatch<
    React.SetStateAction<{
      mode: "clone" | "edit" | "delete";
      sourceId: unknown;
    } | null>
  >;
}

export function createTableNavigationActions({
  activeTab,
  filterMode,
  sqlFilter,
  loadTablePage,
  visualFilters,
  defaultPageSize,
  result,
  isSearchObjectPreview,
  loadDocumentPage,
  isNativeObjectPreview,
  tabConnectionId,
  runTabQuery,
  documentFilterDraft,
  documentSortDraft,
  setDocumentFilterDraft,
  setDocumentSortDraft,
  isMongoDocumentPreview,
  isTransposed,
  dataGridRef,
  setMongoDocumentAction,
}: TableNavigationOptions) {
  const handleSearch = () => {
    if (!activeTab || !activeTab.tableName || !activeTab.schemaName) return;

    if (filterMode === "sql") {
      let whereClause = sqlFilter.trim();
      if (whereClause && !whereClause.toUpperCase().startsWith("WHERE")) {
        whereClause = "WHERE " + whereClause;
      }
      void loadTablePage(activeTab.id, 0, whereClause || null, null, {
        discardAction: "apply the filter",
      });
      return;
    }

    const activeVisualFilters = visualFilters.filter(
      (filter) =>
        filter.column && filter.operator && filter.value.trim().length > 0,
    );

    void loadTablePage(
      activeTab.id,
      0,
      null,
      activeVisualFilters.length > 0 ? activeVisualFilters : null,
      { discardAction: "apply the filter" },
    );
  };

  const page = activeTab.tablePage || 0;
  const pageSize = activeTab.tablePageSize || defaultPageSize;
  const totalRows = activeTab.tableTotalRows;
  const visibleRows = result?.rows.length || 0;
  const startRow = totalRows && visibleRows > 0 ? page * pageSize + 1 : 0;
  const endRow =
    totalRows && visibleRows > 0 ? page * pageSize + visibleRows : visibleRows;
  const canPrevious = page > 0 && !activeTab.isExecuting;
  const canNext =
    !activeTab.isExecuting &&
    (isSearchObjectPreview
      ? Boolean(activeTab.documentHasNextCursor)
      : visibleRows === pageSize &&
        (totalRows == null || (page + 1) * pageSize < totalRows));
  const lastPage =
    totalRows == null ? null : Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  const canLast = lastPage != null && page < lastPage && !activeTab.isExecuting;
  const hasEdits =
    (activeTab.pendingEdits?.size || 0) > 0 ||
    (activeTab.newRowsCount || 0) > 0;
  const handleRefresh = () => {
    if (isSearchObjectPreview) {
      void loadDocumentPage(activeTab.id, 0, {
        discardAction: "refresh the index documents",
      });
      return;
    }
    if (isNativeObjectPreview) {
      if (tabConnectionId && activeTab.sql.trim()) {
        void runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
      }
      return;
    }
    void loadTablePage(activeTab.id, page, undefined, undefined, {
      discardAction: "refresh the table",
    });
  };

  const applyDocumentFilterAndSort = () => {
    if (!isSearchObjectPreview || activeTab.isExecuting) return;
    void loadDocumentPage(activeTab.id, 0, {
      filter: documentFilterDraft.trim() || null,
      sort: documentSortDraft.trim() || null,
      discardAction: "apply the document filter or sort order",
    });
  };

  const clearDocumentFilterAndSort = () => {
    if (!isSearchObjectPreview || activeTab.isExecuting) return;
    setDocumentFilterDraft("");
    setDocumentSortDraft("");
    void loadDocumentPage(activeTab.id, 0, {
      filter: null,
      sort: null,
      discardAction: "clear the document filter or sort order",
    });
  };

  const handleCalculateTotalRows = () => {
    if (
      isSearchObjectPreview ||
      isNativeObjectPreview ||
      activeTab.isExecuting ||
      hasEdits
    ) {
      return;
    }
    void loadTablePage(activeTab.id, page, undefined, undefined, {
      discardAction: "calculate the exact total",
      includeTotal: true,
    });
  };

  const openMongoDocumentAction = (
    mode: "clone" | "edit" | "delete",
    sourceRowIndex?: number,
  ) => {
    if (!isMongoDocumentPreview || !result || isTransposed) return;
    const selectedRows =
      sourceRowIndex === undefined
        ? dataGridRef.current?.getSelectedRowIndexes() || []
        : [sourceRowIndex];
    if (selectedRows.length !== 1) return;
    const selectedRow = selectedRows[0];
    if (selectedRow === undefined) return;
    const idColumn = result.columns.findIndex(
      (column) => column.name === "_id",
    );
    const sourceId =
      idColumn >= 0 ? result.rows[selectedRow]?.[idColumn] : undefined;
    if (sourceId === undefined || sourceId === null) return;
    setMongoDocumentAction({ mode, sourceId });
  };

  const handlePrevious = () => {
    if (canPrevious) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, page - 1, {
          discardAction: "change document pages",
        });
      } else {
        void loadTablePage(activeTab.id, page - 1, undefined, undefined, {
          discardAction: "change pages",
        });
      }
    }
  };

  const handleFirst = () => {
    if (canPrevious) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, 0, {
          discardAction: "return to the first document page",
        });
      } else {
        void loadTablePage(activeTab.id, 0, undefined, undefined, {
          discardAction: "change pages",
        });
      }
    }
  };

  const handleNext = () => {
    if (canNext) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, page + 1, {
          discardAction: "change document pages",
        });
      } else {
        void loadTablePage(activeTab.id, page + 1, undefined, undefined, {
          discardAction: "change pages",
        });
      }
    }
  };

  const handleLast = () => {
    if (canLast && lastPage != null) {
      void loadTablePage(activeTab.id, lastPage, undefined, undefined, {
        discardAction: "change pages",
      });
    }
  };

  return {
    handleSearch,
    handleRefresh,
    applyDocumentFilterAndSort,
    clearDocumentFilterAndSort,
    handleCalculateTotalRows,
    openMongoDocumentAction,
    handlePrevious,
    handleFirst,
    handleNext,
    handleLast,
    page,
    totalRows,
    visibleRows,
    startRow,
    endRow,
    canPrevious,
    canNext,
    canLast,
    hasEdits,
  };
}
