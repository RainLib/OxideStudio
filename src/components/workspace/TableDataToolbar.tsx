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
} from "lucide-react";
import type { ReactNode } from "react";

interface TableDataToolbarProps {
  isExecuting: boolean;
  readOnly: boolean;
  exportDisabled?: boolean;
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
  onImport: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportSql: () => void;
}

export function TableDataToolbar({
  isExecuting,
  readOnly,
  exportDisabled = false,
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
  onImport,
  onExportCsv,
  onExportJson,
  onExportSql,
}: TableDataToolbarProps) {
  const mutationDisabled = isExecuting || readOnly || !editingEnabled;

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
              disabled={readOnly || isExecuting}
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
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <ToolbarSeparator />
        <ToolbarButton
          title={readOnly ? "This object is read-only" : editingEnabled ? "Editing enabled" : "Enable editing"}
          onClick={onToggleEditing}
          disabled={readOnly}
          active={editingEnabled && !readOnly}
        >
          {editingEnabled && !readOnly ? (
            <LockKeyholeOpen size={14} />
          ) : (
            <LockKeyhole size={14} />
          )}
        </ToolbarButton>
        <ToolbarButton title="Import CSV" onClick={onImport} disabled={mutationDisabled}>
          <Upload size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Export CSV"
          onClick={onExportCsv}
          disabled={isExecuting || exportDisabled}
        >
          <Download size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Export JSON"
          onClick={onExportJson}
          disabled={isExecuting || exportDisabled}
        >
          <FileJson size={14} />
        </ToolbarButton>
        <ToolbarButton
          title="Export SQL inserts"
          onClick={onExportSql}
          disabled={isExecuting || exportDisabled}
        >
          <FileCode2 size={14} />
        </ToolbarButton>
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
