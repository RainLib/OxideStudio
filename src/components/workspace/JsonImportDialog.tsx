import { useEffect, useMemo, useState } from "react";
import { AlertCircle, FileJson, FileSpreadsheet, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ColumnInfo,
  TableImportMode,
  TableJsonImportPreview,
  TableXlsxImportPreview,
} from "@/services/tauri/types";

interface JsonImportDialogProps {
  open: boolean;
  preview: TableJsonImportPreview | TableXlsxImportPreview | null;
  format: "JSON" | "XLSX";
  tableName: string;
  columns: ColumnInfo[];
  isSubmitting: boolean;
  onClose: () => void;
  onImport: (mode: TableImportMode) => Promise<void>;
  onPrepareResumable?: (mode: TableImportMode) => void;
}

function previewValue(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function JsonImportDialog({
  open,
  preview,
  format,
  tableName,
  columns,
  isSubmitting,
  onClose,
  onImport,
  onPrepareResumable,
}: JsonImportDialogProps) {
  const [importMode, setImportMode] = useState<TableImportMode>("append");
  useEffect(() => {
    if (open) setImportMode("append");
  }, [open, preview?.contentDigest]);
  const unknownColumns = useMemo(() => {
    if (!preview) return [];
    const targetColumns = new Set(columns.map((column) => column.name.toLocaleLowerCase()));
    return preview.sourceColumns.filter(
      (column) => !targetColumns.has(column.toLocaleLowerCase()),
    );
  }, [columns, preview]);
  const canImport = Boolean(preview) && !isSubmitting && unknownColumns.length === 0;
  const rowLabel = preview?.totalRows === null
    ? `first ${preview?.sampleRows.length || 0} rows sampled`
    : `${(preview?.totalRows || 0).toLocaleString()} rows`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && onClose()}>
      <DialogContent layout="custom" className="h-[min(700px,calc(100vh-32px))] w-[min(1000px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              {format === "XLSX" ? <FileSpreadsheet size={15} /> : <FileJson size={15} />}
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">Import {format} into {tableName}</DialogTitle>
              <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                {preview?.fileName || `${format} data`} · {rowLabel}
                {preview && "sheetName" in preview ? ` · ${preview.sheetName}` : ""}
                {" · review before one transactional commit"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <main className="flex min-h-0 min-w-0 flex-col bg-[hsl(var(--wb-editor))]">
          <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px]">
            <span className="font-medium">Data preview</span>
            <span className="wb-muted">
              {preview?.sourceColumns.length || 0} columns
              {preview?.truncated ? ` · first ${preview.sampleRows.length} rows shown` : ""}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full border-collapse font-mono text-[10px]">
              <thead className="sticky top-0 z-10 bg-[hsl(var(--wb-toolbar))]">
                <tr>
                  <th className="w-12 border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-right font-normal wb-muted">#</th>
                  {(preview?.sourceColumns || []).map((column) => (
                    <th key={column} className="min-w-32 whitespace-nowrap border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-left font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(preview?.sampleRows || []).map((row, rowIndex) => (
                  <tr key={rowIndex} className="hover:bg-[hsl(var(--wb-hover))]">
                    <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-right wb-muted">{rowIndex + 1}</td>
                    {(preview?.sourceColumns || []).map((column) => (
                      <td key={column} className="max-w-80 whitespace-pre-wrap break-words border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 align-top">
                        {previewValue(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {unknownColumns.length > 0 && (
            <section className="shrink-0 border-t border-red-500/25 bg-red-500/5 px-3 py-2 text-[10px] text-red-300" role="alert">
              <div className="flex items-center gap-1.5 font-medium"><AlertCircle size={12} /> {format} columns do not exist on the target table</div>
              <div className="pt-1">{unknownColumns.join(", ")}</div>
            </section>
          )}
        </main>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
            <Select value={importMode} onValueChange={(value) => setImportMode(value as TableImportMode)} disabled={isSubmitting}>
              <SelectTrigger aria-label="Import write mode" className="h-7 w-40 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] text-[10px] focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="append">Append rows</SelectItem>
                <SelectItem value="truncate">Replace all rows</SelectItem>
              </SelectContent>
            </Select>
            <span className="truncate text-[10px] wb-muted">
              {importMode === "truncate"
                ? "Existing rows are replaced in one transaction; an empty source never clears the table."
                : "Database errors roll back the full import transaction."}
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[11px]" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            {onPrepareResumable && <button type="button" className="wb-text-button h-7 whitespace-nowrap px-3 text-[11px]" disabled={!canImport} onClick={() => onPrepareResumable(importMode)}>Prepare resumable…</button>}
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[112px] justify-center px-3 text-[11px]"
              disabled={!canImport}
              onClick={() => void onImport(importMode)}
            >
              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : `${importMode === "truncate" ? "Replace with" : "Import"} ${format}`}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
