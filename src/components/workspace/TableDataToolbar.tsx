import { cn } from "@/lib/utils";
import {
  Check,
  Columns3,
  FileCode2,
  FileJson,
  LockKeyhole,
  LockKeyholeOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
  Download,
  ArrowRightLeft,
  ChevronDown,
  FileSpreadsheet,
  Rows3,
  Square,
} from "lucide-react";
import type { ReactNode } from "react";
import type { TableExportFormat } from "@/services/tauri/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TableDataToolbarProps {
  isExecuting: boolean;
  readOnly: boolean;
  /** A safe alternate presentation that intentionally does not accept edits. */
  viewOnly?: boolean;
  exportDisabled?: boolean;
  exportFormats: readonly TableExportFormat[];
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
  onExportSql: () => void;
  onExportTsv: () => void;
  onExportXlsx: () => void;
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
  onExportSql,
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
        <ToolbarButton
          title={
            selectedRowCount > 0
              ? `Delete ${selectedRowCount} selected row${selectedRowCount === 1 ? "" : "s"}`
              : "Select rows to delete"
          }
          onClick={onDeleteRows}
          disabled={mutationDisabled || selectedRowCount === 0}
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
              Import CSV…
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
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportXlsx}>
                <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                Export Excel workbook (.xlsx)
              </DropdownMenuItem>
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
            {supportsExport("tsv") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportTsv}>
                <FileSpreadsheet className="mr-2 h-3.5 w-3.5" />
                Export TSV
              </DropdownMenuItem>
            )}
            {supportsExport("sql") && (
              <DropdownMenuItem className="wb-menu-item" onSelect={onExportSql}>
                <FileCode2 className="mr-2 h-3.5 w-3.5" />
                Export SQL INSERT statements
              </DropdownMenuItem>
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
