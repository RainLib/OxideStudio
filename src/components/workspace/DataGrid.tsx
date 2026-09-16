import {
  ColumnFormatterDialog,
  DataGridContextMenu,
  DataGridHoverTooltip,
  transposeQueryResult,
  type ColumnFormatterConfig,
} from "@/features/data-grid";
import { useGridCellContent } from "@/features/data-grid/hooks/useGridCellContent";
import { useGridClipboard } from "@/features/data-grid/hooks/useGridClipboard";
import { useGridColumnLookup } from "@/features/data-grid/hooks/useGridColumnLookup";
import { useGridColumns } from "@/features/data-grid/hooks/useGridColumns";
import { useGridContextMenu } from "@/features/data-grid/hooks/useGridContextMenu";
import { useGridEditing } from "@/features/data-grid/hooks/useGridEditing";
import { useGridFormatting } from "@/features/data-grid/hooks/useGridFormatting";
import { useGridLayoutRestore } from "@/features/data-grid/hooks/useGridLayoutRestore";
import { useGridPaste } from "@/features/data-grid/hooks/useGridPaste";
import { useGridQueryToolbar } from "@/features/data-grid/hooks/useGridQueryToolbar";
import { useGridRows } from "@/features/data-grid/hooks/useGridRows";
import { useGridSelectionSummary } from "@/features/data-grid/hooks/useGridSelectionSummary";
import { useGridTheme } from "@/features/data-grid/hooks/useGridTheme";
import { useGridValueEditor } from "@/features/data-grid/hooks/useGridValueEditor";
import {
  type DataGridHandle,
  type DataGridProps,
} from "@/features/data-grid/model/gridTypes";
import { GridColumnLookup } from "@/features/data-grid/ui/GridColumnLookup";
import { GridQueryError } from "@/features/data-grid/ui/GridQueryError";
import { GridQueryToolbar } from "@/features/data-grid/ui/GridQueryToolbar";
import { dataGridMetrics } from "@/lib/dataGridView";
import { presentQueryError } from "@/lib/queryErrorPresentation";
import { isActiveQueryResultLoading } from "@/lib/queryResultLoadingState";
import { useAssistantComposerStore } from "@/store/useAssistantComposerStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import {
  CompactSelection,
  DataEditor,
  GridSelection,
  type DataEditorRef,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import {
  forwardRef,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { DataGridBusyIndicator } from "./DataGridBusyIndicator";
import { SelectionAggregateBar } from "./SelectionAggregateBar";
import { ValueEditorDialog } from "./ValueEditorDialog";

const EMPTY_PENDING_EDITS = new Map<string, unknown>();

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
        const tab = state.tabs.find(
          (candidate) => candidate.id === state.activeTabId,
        );
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
              nativeQueryHasMore: tab.nativeQueryHasMore,
              activeResultIndex: tab.activeResultIndex,
              activeResultRunId: tab.activeResultRunId,
              executingResultIndex: tab.executingResultIndex,
              executingResultRunId: tab.executingResultRunId,
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
      loadMoreNativeQueryPage,
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
        loadMoreNativeQueryPage: state.loadMoreNativeQueryPage,
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
    const updateSettings = useSettingsStore((state) => state.updateSettings);
    const copyIncludeHeaders = dataGridSettings.copyIncludeHeaders;
    const showTypeIcons = dataGridSettings.showTypeIcons;
    const showColumnTypesInHeader = dataGridSettings.showColumnTypesInHeader;
    const showColumnCommentsInHeader =
      dataGridSettings.showColumnCommentsInHeader;
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
    const activeTabKind = activeTab?.type === "table" ? "table" : "query";
    const isActiveResultExecuting = isActiveQueryResultLoading({
      isExecuting: Boolean(activeTab?.isExecuting),
      tabType: activeTabKind,
      activeResultIndex: resultIndex,
      activeResultRunId: activeTab?.activeResultRunId,
      executingResultIndex: activeTab?.executingResultIndex,
      executingResultRunId: activeTab?.executingResultRunId,
    });
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
    const isEditable =
      activeTab?.type === "table" && !readOnly && !isTransposed;
    const columnWidths = activeTab?.columnWidths || {};
    const columnOrder = activeTab?.columnOrder || [];
    const hiddenColumns = activeTab?.hiddenColumns || [];
    const frozenColumnCount = isTransposed
      ? Math.min(1, Math.max(0, (result?.columns.length || 0) - 1))
      : Math.min(
          activeTab?.frozenColumnCount || 0,
          Math.max(
            0,
            (result?.columns.length || overrideColumns?.length || 0) - 1,
          ),
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
    const [formatterTarget, setFormatterTarget] = useState<{
      columnIndex: number;
      columnName: string;
      keys: string[];
      sampleValue: unknown;
    } | null>(null);

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const dataEditorRef = useRef<DataEditorRef>(null);
    const { queryToolbarRef, queryToolbarCompact } = useGridQueryToolbar({
      activeTab,
      result,
      isTransposed,
    });

    const {
      tableColumnsByName,
      tableColumns,
      formatterForResultColumn,
      formatterKeysForResultColumn,
    } = useGridFormatting({
      activeTab,
      result,
      resultOverride,
      isTransposed,
      activeConnection,
      dataGridSettings,
    });

    useGridLayoutRestore({
      isTransposed,
      result,
      overrideColumns,
      activeTab,
      restoreColumnLayout,
    });

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
    const {
      columns,
      reserveHeaderTypeLine,
      reserveHeaderCommentLine,
      visibleHeaderMetadata,
    } = useGridColumns({
      isTransposed,
      result,
      gridScale,
      showTypeIcons,
      gridState,
      columnWidths,
      tableColumnsByName,
      hiddenColumns,
      columnOrder,
      overrideColumns,
      tableColumns,
      formatterForResultColumn,
      showColumnTypesInHeader,
      showColumnCommentsInHeader,
    });

    const {
      openColumnLookup,
      onColumnLookupKeyDown,
      filteredColumnLookupItems,
      selectColumnLookupItem,
      columnLookupOpen,
      columnLookupQuery,
      setColumnLookupQuery,
      columnLookupSelectedIndex,
      setColumnLookupSelectedIndex,
      columnLookupInputRef,
    } = useGridColumnLookup({
      isTransposed,
      columns,
      result,
      overrideColumns,
      tableColumnsByName,
      dataEditorRef,
    });

    const { visualRows } = useGridRows({
      result,
      isTransposed,
      columnFilters,
      globalFilter,
      gridState,
      activeTab,
      newRowsCount,
    });

    const { selectedRowIndexes, selectionAggregate } = useGridSelectionSummary({
      gridSelection,
      visualRows,
      onSelectionSummaryChange,
      columns,
      result,
      isTransposed,
      tableColumnsByName,
      deferredGridSelectionContext,
      activeTabId,
      resultIndex,
      pendingEdits,
    });

    const { getCellContent } = useGridCellContent({
      result,
      overrideColumns,
      visualRows,
      columns,
      isTransposed,
      pendingEdits,
      tableColumnsByName,
      isEditable,
      formatterForResultColumn,
      tableColumns,
    });

    const { onHeaderMenuClick, onCellEdited, onColumnResize, onColumnMoved } =
      useGridEditing({
        activeTab,
        result,
        isTransposed,
        columns,
        gridState,
        setGridSort,
        isEditable,
        visualRows,
        overrideColumns,
        tableColumnsByName,
        gridSelection,
        setCellEdit,
        setBulkCellEdit,
        setColumnWidth,
        gridScale,
        setColumnOrder,
      });

    const { visualColumnIndexToResultIndex, onCellsEdited, onPaste } =
      useGridPaste({
        columns,
        result,
        isTransposed,
        overrideColumns,
        tableColumnsByName,
        activeTab,
        isEditable,
        visualRows,
        setBulkCellEdit,
        gridSelection,
        pendingEdits,
        applyNewRowPaste,
      });

    const {
      openValueEditor,
      onCellActivated,
      onGridKeyDown,
      valueEditorNavigation,
      navigateValueEditor,
      valueEditorTarget,
      setValueEditorTarget,
    } = useGridValueEditor({
      activeTab,
      visualColumnIndexToResultIndex,
      visualRows,
      result,
      overrideColumns,
      tableColumnsByName,
      isEditable,
      pendingEdits,
      openColumnLookup,
      getCellContent,
      isTransposed,
      columns,
    });

    const { onCopy, handleCopyAll, handleExport } = useGridClipboard({
      result,
      copyIncludeHeaders,
      activeConnection,
      activeTab,
      visualRows,
      pendingEdits,
      visualColumnIndexToResultIndex,
    });

    const {
      contextMenuItems,
      onHeaderContextMenu,
      onCellContextMenu,
      onItemHovered,
      closeContextMenu,
      handleDeleteSelectedRows,
      contextMenu,
      setContextMenu,
      hoverTooltip,
      setHoverTooltip,
    } = useGridContextMenu({
      gridContainerRef,
      isTransposed,
      result,
      overrideColumns,
      columns,
      visualColumnIndexToResultIndex,
      setGridSelection,
      tableColumnsByName,
      getCellContent,
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
      gridState,
      hiddenColumns,
      onCopy,
      gridSelection,
      onEditDocument,
      onCloneDocument,
      onDeleteDocument,
    });

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
      [
        columns.length,
        handleDeleteSelectedRows,
        openColumnLookup,
        selectedRowIndexes,
      ],
    );

    const { drawColumnHeader, gridTheme, dataGridHeaderHeight } = useGridTheme({
      viewMetrics,
      gridScale,
      isTransposed,
      reserveHeaderTypeLine,
      reserveHeaderCommentLine,
      visibleHeaderMetadata,
      showTypeIcons,
      gridState,
    });

    if (error && errorPresentation) {
      return (
        <GridQueryError
          errorPresentation={errorPresentation}
          activeTab={activeTab}
          queueQueryErrorFix={queueQueryErrorFix}
          runTabQuery={runTabQuery}
        />
      );
    }

    return (
      <div className="wb-data-grid flex h-full flex-col wb-grid-surface">
        {activeTab?.type !== "table" && result && (
          <GridQueryToolbar
            queryToolbarRef={queryToolbarRef}
            queryToolbarCompact={queryToolbarCompact}
            isTransposed={isTransposed}
            sourceResult={sourceResult}
            result={result}
            activeTab={activeTab}
            isActiveResultExecuting={isActiveResultExecuting}
            loadMoreNativeQueryPage={loadMoreNativeQueryPage}
            setQueryResultTransposed={setQueryResultTransposed}
            handleCopyAll={handleCopyAll}
            handleExport={handleExport}
          />
        )}

        {/* DataEditor container with overlay */}
        <div
          ref={gridContainerRef}
          className="flex-1 overflow-hidden relative"
          aria-busy={isActiveResultExecuting || undefined}
        >
          {!result && (!overrideColumns || overrideColumns.length === 0) ? (
            !isActiveResultExecuting && (
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
                drawHeader={drawColumnHeader}
                freezeColumns={frozenColumnCount}
                rows={visualRows.length}
                onHeaderMenuClick={isTransposed ? undefined : onHeaderMenuClick}
                onHeaderContextMenu={
                  isTransposed ? undefined : onHeaderContextMenu
                }
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
                headerHeight={dataGridHeaderHeight}
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
                <GridColumnLookup
                  columnLookupInputRef={columnLookupInputRef}
                  columnLookupQuery={columnLookupQuery}
                  setColumnLookupQuery={setColumnLookupQuery}
                  onColumnLookupKeyDown={onColumnLookupKeyDown}
                  filteredColumnLookupItems={filteredColumnLookupItems}
                  columnLookupSelectedIndex={columnLookupSelectedIndex}
                  setColumnLookupSelectedIndex={setColumnLookupSelectedIndex}
                  selectColumnLookupItem={selectColumnLookupItem}
                />
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

          {isActiveResultExecuting && (
            <DataGridBusyIndicator kind={activeTabKind} />
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
        <ColumnFormatterDialog
          open={formatterTarget !== null}
          columnName={formatterTarget?.columnName || "column"}
          sampleValue={formatterTarget?.sampleValue}
          formatter={
            formatterTarget
              ? formatterForResultColumn(formatterTarget.columnIndex)
              : undefined
          }
          onOpenChange={(open) => {
            if (!open) setFormatterTarget(null);
          }}
          onSave={(formatter: ColumnFormatterConfig) => {
            if (!formatterTarget) return;
            const next = { ...dataGridSettings.columnFormatters };
            for (const key of formatterTarget.keys) delete next[key];
            next[formatterTarget.keys[0]!] = formatter;
            void updateSettings({
              dataGrid: { ...dataGridSettings, columnFormatters: next },
            });
            setFormatterTarget(null);
          }}
          onClear={() => {
            if (!formatterTarget) return;
            const next = { ...dataGridSettings.columnFormatters };
            for (const key of formatterTarget.keys) delete next[key];
            void updateSettings({
              dataGrid: { ...dataGridSettings, columnFormatters: next },
            });
            setFormatterTarget(null);
          }}
        />
      </div>
    );
  },
);

export type {
  DataGridHandle,
  DataGridSelectionSummary,
} from "@/features/data-grid/model/gridTypes";
