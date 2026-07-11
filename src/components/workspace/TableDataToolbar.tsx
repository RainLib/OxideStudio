import { cn } from "@/lib/utils";
import { GRID_ZOOM_MAX, GRID_ZOOM_MIN } from "@/lib/dataGridView";
import {
  Check,
  Columns3,
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
  ZoomIn,
  ZoomOut,
  Download,
} from "lucide-react";
import type { ReactNode } from "react";

interface TableDataToolbarProps {
  isExecuting: boolean;
  readOnly: boolean;
  editingEnabled: boolean;
  hasEdits: boolean;
  selectedRowCount: number;
  zoomPercent: number;
  onRefresh: () => void;
  onAddRow: () => void;
  onDeleteRows: () => void;
  onSave: () => void;
  onRevert: () => void;
  onSearch: () => void;
  onFitColumns: () => void;
  onResetColumns: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomIn: () => void;
  onToggleEditing: () => void;
  onImport: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
}

export function TableDataToolbar({
  isExecuting,
  readOnly,
  editingEnabled,
  hasEdits,
  selectedRowCount,
  zoomPercent,
  onRefresh,
  onAddRow,
  onDeleteRows,
  onSave,
  onRevert,
  onSearch,
  onFitColumns,
  onResetColumns,
  onZoomOut,
  onZoomReset,
  onZoomIn,
  onToggleEditing,
  onImport,
  onExportCsv,
  onExportJson,
}: TableDataToolbarProps) {
  const mutationDisabled = isExecuting || readOnly || !editingEnabled;

  return (
    <div className="wb-table-commandbar">
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
        <ToolbarButton title="Submit changes" onClick={onSave} disabled={!hasEdits || isExecuting}>
          <Check size={14} />
        </ToolbarButton>
        <ToolbarButton title="Revert changes" onClick={onRevert} disabled={!hasEdits || isExecuting}>
          <Undo2 size={14} />
        </ToolbarButton>
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
        <ToolbarSeparator />
        <ToolbarButton
          title="Zoom out (Ctrl/Cmd -)"
          onClick={onZoomOut}
          disabled={zoomPercent <= GRID_ZOOM_MIN}
        >
          <ZoomOut size={14} />
        </ToolbarButton>
        <button
          type="button"
          className="h-6 w-12 shrink-0 rounded-[3px] text-center text-[10px] tabular-nums text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
          onClick={onZoomReset}
          title="Reset grid zoom"
        >
          {zoomPercent}%
        </button>
        <ToolbarButton
          title="Zoom in (Ctrl/Cmd +)"
          onClick={onZoomIn}
          disabled={zoomPercent >= GRID_ZOOM_MAX}
        >
          <ZoomIn size={14} />
        </ToolbarButton>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <ToolbarSeparator />
        <ToolbarButton
          title={readOnly ? "This object is read-only" : editingEnabled ? "Disable editing" : "Enable editing"}
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
        <ToolbarButton title="Export CSV" onClick={onExportCsv} disabled={isExecuting}>
          <Download size={14} />
        </ToolbarButton>
        <ToolbarButton title="Export JSON" onClick={onExportJson} disabled={isExecuting}>
          <FileJson size={14} />
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
