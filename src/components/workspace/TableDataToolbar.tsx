import { cn } from "@/lib/utils";
import {
  Check,
  Columns3,
  FileCode2,
  FileJson,
  LockKeyhole,
  LockKeyholeOpen,
  Plus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
  Download,
  ArrowRightLeft,
  CopyPlus,
  ChevronDown,
  FileSpreadsheet,
  Rows3,
  Square,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  SqlInsertConflictPolicy,
  TableExportFormat,
} from "@/services/tauri/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TableDataToolbarProps {
  isExecuting: boolean;
  readOnly: boolean;
  /** A safe alternate presentation that intentionally does not accept edits. */
  viewOnly?: boolean;
  exportDisabled?: boolean;
  exportFormats: readonly TableExportFormat[];
  /** Undefined exports every row matching the current filters and sort. */
  exportMaxRows?: number;
  onExportMaxRowsChange?: (maxRows: number | undefined) => void;
  supportsSqlConflictSkip?: boolean;
  supportsSqlConflictUpdate?: boolean;
  isExporting?: boolean;
  transferDisabled?: boolean;
  editingEnabled: boolean;
  hasEdits: boolean;
  editedCellCount: number;
  newRowCount: number;
  selectedRowCount: number;
  onRefresh: () => void;
  onAddRow: () => void;
  onDeleteRows: () => void;
  /** Native documents use reviewed Host mutations instead of grid staging. */
  onEditDocument?: () => void;
  onDeleteDocument?: () => void;
  /** Native document clones have their own reviewed Host mutation path. */
  onCloneDocument?: () => void;
  cloneDocumentDisabled?: boolean;
  onSave: () => void;
  onRevert: () => void;
  onSearch: () => void;
  onFitColumns: () => void;
  onResetColumns: () => void;
  onToggleEditing: () => void;
  transposed?: boolean;
  transposeDisabled?: boolean;
  onToggleTranspose?: () => void;
  onImportCsv: () => void;
  onImportJson: () => void;
  onImportXlsx: () => void;
  onTransfer?: () => void;
  onExportCsv: () => void;
  onExportCsvBom: () => void;
  onExportJson: () => void;
  onExportJsonl: () => void;
  onExportMarkdown: () => void;
  onExportSql: (
    batchSize: number,
    conflictPolicy?: SqlInsertConflictPolicy,
  ) => void;
  /** Available only for the reviewed built-in PostgreSQL backup route. */
  onExportDatabaseSql?: (scope: "all" | "structure" | "data") => void;
  onExportTsv: () => void;
  onExportXlsx: (autoFilter: boolean) => void;
  onExportParquet: () => void;
  onExportArrow: () => void;
  onCancelExport?: () => void;
}

export function TableDataToolbar({
  isExecuting,
  readOnly,
  viewOnly = false,
  exportDisabled = false,
  exportFormats,
  exportMaxRows,
  onExportMaxRowsChange,
  supportsSqlConflictSkip = false,
  supportsSqlConflictUpdate = false,
  isExporting = false,
  transferDisabled = false,
  editingEnabled,
  hasEdits,
  editedCellCount,
  newRowCount,
  selectedRowCount,
  onRefresh,
  onAddRow,
  onDeleteRows,
  onEditDocument,
  onDeleteDocument,
  onCloneDocument,
  cloneDocumentDisabled = false,
  onSave,
  onRevert,
  onSearch,
  onFitColumns,
  onResetColumns,
  onToggleEditing,
  transposed = false,
  transposeDisabled = false,
  onToggleTranspose,
  onImportCsv,
  onImportJson,
  onImportXlsx,
  onTransfer = () => undefined,
  onExportCsv,
  onExportCsvBom,
  onExportJson,
  onExportJsonl,
  onExportMarkdown,
  onExportSql,
  onExportDatabaseSql,
  onExportTsv,
  onExportXlsx,
  onExportParquet,
  onExportArrow,
  onCancelExport,
}: TableDataToolbarProps) {
  const mutationDisabled = isExecuting || readOnly || viewOnly || !editingEnabled;
  const supportsExport = (format: TableExportFormat) =>
    exportFormats.includes(format);
  const editingTitle = readOnly
    ? "This object is read-only"
    : viewOnly
      ? "Transpose view is read-only; return to the grid to edit"
      : editingEnabled
        ? "Editing enabled"
        : "Enable editing";

  return (
    <div className="wb-table-commandbar h-8 border-b border-[hsl(var(--wb-border-subtle))] px-1.5">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        <ToolbarButton title="Refresh data" onClick={onRefresh} disabled={isExecuting}>
          <RefreshCw size={14} className={cn(isExecuting && "animate-spin")} />
        </ToolbarButton>
        <ToolbarSeparator />
        <ToolbarButton title="Add row" onClick={onAddRow} disabled={mutationDisabled}>
          <Plus size={14} />
        </ToolbarButton>
        {onEditDocument && (
          <ToolbarButton
            title={
              selectedRowCount === 1
                ? "Edit selected MongoDB document"
                : "Select one MongoDB document to edit"
            }
            onClick={onEditDocument}
            disabled={isExecuting || viewOnly || selectedRowCount !== 1}
          >
            <Pencil size={14} />
          </ToolbarButton>
        )}
        {onCloneDocument && (
          <ToolbarButton
            title={
              selectedRowCount === 1
                ? "Clone selected MongoDB document"
                : "Select one MongoDB document to clone"
            }
            onClick={onCloneDocument}
            disabled={
              isExecuting ||
              viewOnly ||
              cloneDocumentDisabled ||
              selectedRowCount !== 1
            }
          >
            <CopyPlus size={14} />
          </ToolbarButton>
        )}
        <ToolbarButton
          title={
            selectedRowCount > 0
              ? onDeleteDocument
                ? "Review deletion of selected MongoDB document"
                : `Delete ${selectedRowCount} selected row${selectedRowCount === 1 ? "" : "s"}`
              : "Select rows to delete"
          }
          onClick={onDeleteDocument ?? onDeleteRows}
          disabled={
            onDeleteDocument
              ? isExecuting || viewOnly || selectedRowCount !== 1
              : mutationDisabled || selectedRowCount === 0
          }
          danger
        >
          <Trash2 size={14} />
        </ToolbarButton>
        {hasEdits ? (
          <>
            <button
              type="button"
              className="ml-1 inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[3px] bg-[hsl(var(--wb-accent))] px-2 text-[10px] font-medium text-[hsl(var(--wb-accent-foreground))] hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
              title="Submit changes to the database"
              aria-label="Submit changes"
              onClick={onSave}
              disabled={readOnly || viewOnly || isExecuting}
            >
              <Check size={12} />
              Submit {editedCellCount + newRowCount}
            </button>
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-1 px-1.5 text-[10px] wb-muted hover:text-[hsl(var(--wb-text))] disabled:opacity-50"
              title="Revert unsaved changes"
              aria-label="Revert changes"
              onClick={onRevert}
              disabled={isExecuting}
            >
              <Undo2 size={12} />
              Revert
            </button>
          </>
        ) : (
          <>
            <ToolbarButton title="Submit changes" onClick={onSave} disabled>
              <Check size={14} />
            </ToolbarButton>
            <ToolbarButton title="Revert changes" onClick={onRevert} disabled>
              <Undo2 size={14} />
            </ToolbarButton>
          </>
        )}
        <ToolbarSeparator />
        <ToolbarButton title="Find in data grid" onClick={onSearch}>
          <Search size={14} />
        </ToolbarButton>
        <ToolbarButton title="Fit all columns" onClick={onFitColumns}>
          <Columns3 size={14} />
        </ToolbarButton>
        <ToolbarButton title="Reset column layout" onClick={onResetColumns}>
          <RotateCcw size={14} />
        </ToolbarButton>
        {onToggleTranspose && (
          <ToolbarButton
            title={
              transposed
                ? "Show standard grid"
                : transposeDisabled
                  ? "Submit or revert changes before transposing"
                  : "Transpose rows and columns"
            }
            onClick={onToggleTranspose}
            disabled={isExecuting || transposeDisabled}
            active={transposed}
          >
            <Rows3 size={14} />
          </ToolbarButton>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <ToolbarSeparator />
        <ToolbarButton
          title={editingTitle}
          onClick={onToggleEditing}
          disabled={readOnly || viewOnly}
          active={editingEnabled && !readOnly && !viewOnly}
        >
          {editingEnabled && !readOnly && !viewOnly ? (
            <LockKeyholeOpen size={14} />
          ) : (
            <LockKeyhole size={14} />
          )}
        </ToolbarButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[3px] px-1.5 wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))] disabled:pointer-events-none disabled:opacity-40"
              title="Import data"
              aria-label="Import data"
              disabled={mutationDisabled}
            >
              <Upload size={14} />
              <ChevronDown size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="wb-menu-content min-w-36">
            <DropdownMenuItem className="wb-menu-item" onSelect={onImportCsv}>
              <Upload className="mr-2 h-3.5 w-3.5" />
              Import CSV / TSV…
            </DropdownMenuItem>
            <DropdownMenuItem className="wb-menu-item" onSelect={onImportJson}>
              <FileJson className="mr-2 h-3.5 w-3.5" />
              Import JSON…
            </DropdownMenuItem>
            <DropdownMenuItem className="wb-menu-item" onSelect={onImportXlsx}>
              <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
              Import XLSX…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolbarButton
          title="Transfer data to another table"
          onClick={onTransfer}
          disabled={isExecuting || transferDisabled}
        >
          <ArrowRightLeft size={14} />
        </ToolbarButton>
        {isExporting && onCancelExport && (
          <ToolbarButton
            title="Cancel active export"
            onClick={onCancelExport}
            danger
          >
            <Square size={12} fill="currentColor" />
          </ToolbarButton>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[3px] px-1.5 wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-focus))] disabled:pointer-events-none disabled:opacity-40"
              title="Export table data"
              aria-label="Export table data"
              disabled={
                isExecuting ||
                exportDisabled ||
                isExporting ||
                exportFormats.length === 0
              }
            >
              <Download size={14} />
              <ChevronDown size={10} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="wb-menu-content min-w-52">
            {onExportMaxRowsChange && (
              <>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="wb-menu-item">
                    <Rows3 className="mr-2 h-3.5 w-3.5" />
                    Export scope
                    <span className="ml-auto pl-3 text-[10px] wb-muted">
                      {exportMaxRows
                        ? `First ${exportMaxRows.toLocaleString()}`
                        : "All matching"}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="wb-menu-content min-w-48">
                      {([
                        [undefined, "All matching rows"],
                        [1_000, "First 1,000 rows"],
                        [10_000, "First 10,000 rows"],
                        [100_000, "First 100,000 rows"],
                      ] as const).map(([maxRows, label]) => (
                        <DropdownMenuItem
                          key={maxRows ?? "all"}
                          className="wb-menu-item"
                          onSelect={() => onExportMaxRowsChange(maxRows)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-3.5 w-3.5",
                              exportMaxRows === maxRows
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            {supportsExport("csv") && (
              <>
                <DropdownMenuItem className="wb-menu-item" onSelect={onExportCsv}>
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                  Export CSV (UTF-8)
                </DropdownMenuItem>
                <DropdownMenuItem className="wb-menu-item" onSelect={onExportCsvBom}>
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                  Export CSV (UTF-8 BOM / Excel)
                </DropdownMenuItem>
              </>
            )}
            {supportsExport("xlsx") && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="wb-menu-item">
                  <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                  Export Excel workbook (.xlsx)
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="wb-menu-content min-w-64">
                    <DropdownMenuItem
                      className="wb-menu-item"
                      onSelect={() => onExportXlsx(true)}
                    >
                      <Check className="mr-2 h-3.5 w-3.5" />
                      With header filters
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="wb-menu-item"
                      onSelect={() => onExportXlsx(false)}
                    >
                      <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                      Without header filters
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
            {supportsExport("parquet") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportParquet}>
                <FileCode2 className="mr-2 h-3.5 w-3.5" />
                Export Apache Parquet (.parquet)
              </DropdownMenuItem>
            )}
            {supportsExport("arrow") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportArrow}>
                <FileCode2 className="mr-2 h-3.5 w-3.5" />
                Export Arrow IPC file (.arrow)
              </DropdownMenuItem>
            )}
            {supportsExport("json") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportJson}>
                <FileJson className="mr-2 h-3.5 w-3.5" />
                Export JSON
              </DropdownMenuItem>
            )}
            {supportsExport("jsonl") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportJsonl}>
                <FileJson className="mr-2 h-3.5 w-3.5" />
                Export JSON Lines
              </DropdownMenuItem>
            )}
            {supportsExport("markdown") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportMarkdown}>
                <FileCode2 className="mr-2 h-3.5 w-3.5" />
                Export Markdown table (.md)
              </DropdownMenuItem>
            )}
            {supportsExport("tsv") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportTsv}>
                <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                Export TSV
              </DropdownMenuItem>
            )}
            {supportsExport("sql") && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="wb-menu-item">
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  Export SQL INSERT statements
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="wb-menu-content min-w-48">
                    {[25, 100, 250, 500, 1000].map((batchSize) => (
                      <DropdownMenuItem
                        key={batchSize}
                        className="wb-menu-item"
                        onSelect={() => onExportSql(batchSize)}
                      >
                        <span>{batchSize.toLocaleString()} rows / statement</span>
                        {batchSize === 100 && (
                          <span className="ml-auto pl-3 text-[10px] wb-muted">
                            Recommended
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                    {supportsSqlConflictSkip && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="wb-menu-item"
                          onSelect={() => onExportSql(100, "skip")}
                        >
                          <span>Skip conflicting rows</span>
                          <span className="ml-auto pl-3 text-[10px] wb-muted">
                            100 / statement
                          </span>
                        </DropdownMenuItem>
                      </>
                    )}
                    {supportsSqlConflictUpdate && (
                      <DropdownMenuItem
                        className="wb-menu-item"
                        onSelect={() => onExportSql(100, "update")}
                      >
                        <span>Update conflicting rows</span>
                        <span className="ml-auto pl-3 text-[10px] wb-muted">
                          Primary key
                        </span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
            {onExportDatabaseSql && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="wb-menu-item">
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  Backup PostgreSQL schema to SQL
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent className="wb-menu-content min-w-52">
                    <DropdownMenuItem
                      className="wb-menu-item"
                      onSelect={() => onExportDatabaseSql("all")}
                    >
                      Structure and data
                      <span className="ml-auto pl-3 text-[10px] wb-muted">
                        Recommended
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="wb-menu-item"
                      onSelect={() => onExportDatabaseSql("structure")}
                    >
                      Structure only
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="wb-menu-item"
                      onSelect={() => onExportDatabaseSql("data")}
                    >
                      Data only
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  title,
  disabled,
  active,
  danger,
  onClick,
}: {
  children: ReactNode;
  title: string;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "wb-icon-button h-7 w-7",
        active && "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
        danger && "hover:text-[hsl(var(--destructive))]"
      )}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-[hsl(var(--wb-border-subtle))]" />;
}
