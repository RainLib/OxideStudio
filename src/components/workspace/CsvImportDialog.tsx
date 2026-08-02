import { useEffect, useMemo, useState } from "react";
import { AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColumnInfo, TableCsvImportOptions } from "@/services/tauri/types";
import {
  buildCsvImportPlan,
  createCsvColumnMapping,
  csvSourceColumns,
  decodeCsvBytes,
  inferCsvDelimiter,
  parseCsv,
  type CsvColumnMapping,
  type CsvEncoding,
} from "@/lib/csvImport";

interface CsvImportDialogProps {
  open: boolean;
  file: File | null;
  tableName: string;
  columns: ColumnInfo[];
  isSubmitting: boolean;
  isNativeSource?: boolean;
  nativePreviewTruncated?: boolean;
  onClose: () => void;
  onImport: (
    rows: Array<Record<string, unknown>>,
    options: TableCsvImportOptions,
    sourceEncoding: CsvEncoding,
  ) => Promise<void>;
}

type DelimiterChoice = "auto" | "comma" | "semicolon" | "tab" | "pipe" | "custom";

const PREVIEW_ROW_LIMIT = 50;
const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_IMPORT_ROWS = 100_000;
const fieldClass =
  "h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]";
const selectClass = `${fieldClass} focus:ring-0 focus:ring-offset-0`;

export function CsvImportDialog({
  open,
  file,
  tableName,
  columns,
  isSubmitting,
  isNativeSource = false,
  nativePreviewTruncated = false,
  onClose,
  onImport,
}: CsvImportDialogProps) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [delimiterChoice, setDelimiterChoice] = useState<DelimiterChoice>("auto");
  const [customDelimiter, setCustomDelimiter] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [mapping, setMapping] = useState<CsvColumnMapping[]>([]);

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setBytes(null);
    setLoadError(null);
    setIsLoading(true);
    setEncoding("auto");
    setDelimiterChoice("auto");
    setCustomDelimiter("");
    setHasHeader(true);
    setEmptyAsNull(true);
    setMapping([]);

    const readFile = async () => {
      try {
        if (file.size > MAX_IMPORT_FILE_BYTES) {
          throw new Error(
            "CSV files larger than 32 MiB can be imported from Database Explorer → Import/Export → Import CSV (streaming)… using UTF-8, comma delimiters, and a header row.",
          );
        }
        const buffer = typeof file.arrayBuffer === "function"
          ? await file.arrayBuffer()
          : new TextEncoder().encode(await file.text()).buffer;
        if (!cancelled) setBytes(new Uint8Array(buffer));
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void readFile();

    return () => {
      cancelled = true;
    };
  }, [file, open]);

  const decoded = useMemo(() => {
    if (!bytes) return { text: "", encoding: "utf-8" as const, error: null };
    try {
      return { ...decodeCsvBytes(bytes, encoding), error: null };
    } catch (error) {
      return {
        text: "",
        encoding: "utf-8" as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [bytes, encoding]);

  const delimiter = useMemo(() => {
    switch (delimiterChoice) {
      case "comma":
        return ",";
      case "semicolon":
        return ";";
      case "tab":
        return "\t";
      case "pipe":
        return "|";
      case "custom":
        return customDelimiter;
      default:
        return inferCsvDelimiter(decoded.text);
    }
  }, [customDelimiter, decoded.text, delimiterChoice]);

  const parsed = useMemo(
    () => parseCsv(decoded.text, delimiter, MAX_IMPORT_ROWS + (hasHeader ? 2 : 1)),
    [decoded.text, delimiter, hasHeader],
  );
  const sourceColumns = useMemo(
    () => csvSourceColumns(parsed.records, hasHeader),
    [hasHeader, parsed.records],
  );
  const mappingSignature = useMemo(
    () => `${hasHeader}:${sourceColumns.join("\u0000")}:${columns.map((column) => column.name).join("\u0000")}`,
    [columns, hasHeader, sourceColumns],
  );

  useEffect(() => {
    setMapping(createCsvColumnMapping(sourceColumns, columns, hasHeader));
  }, [mappingSignature]);

  const plan = useMemo(
    () => buildCsvImportPlan({
      records: parsed.records,
      parseIssues: parsed.issues,
      hasHeader,
      mapping,
      columns,
      emptyAsNull,
    }),
    [columns, emptyAsNull, hasHeader, mapping, parsed.issues, parsed.records],
  );
  const dataRecords = hasHeader ? parsed.records.slice(1) : parsed.records;
  const previewRecords = dataRecords.slice(0, PREVIEW_ROW_LIMIT);
  const rowLimitError = dataRecords.length > MAX_IMPORT_ROWS
    ? `CSV contains more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Use Database Explorer → Import/Export → Import CSV (streaming)… for a larger standard CSV.`
    : null;
  const nativePreviewError = nativePreviewTruncated
    ? "This CSV is larger than the 32 MiB review limit. Use Import CSV (streaming)… for a standard UTF-8 comma-delimited import, or split the file before using column mapping."
    : null;
  const blockingError = loadError || decoded.error || rowLimitError || nativePreviewError;
  const canImport =
    !isLoading &&
    !isSubmitting &&
    !blockingError &&
    plan.errorCount === 0 &&
    plan.rows.length > 0;

  const updateMapping = (sourceIndex: number, value: string) => {
    setMapping((current) => current.map((item) =>
      item.sourceIndex === sourceIndex
        ? { ...item, targetColumn: value === "__ignore__" ? null : value }
        : item
    ));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && onClose()}>
      <DialogContent className="h-[min(820px,calc(100vh-32px))] w-[min(1120px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <FileSpreadsheet size={15} />
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">Import CSV into {tableName}</DialogTitle>
              <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                {file?.name || "CSV file"} · Preview and validate before one transactional commit
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))]">
            <section className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-[hsl(var(--wb-border-subtle))] p-3">
              <label className="pt-1.5 text-[10px] wb-muted">Encoding</label>
              <Select value={encoding} onValueChange={(value) => setEncoding(value as CsvEncoding)} disabled={isLoading}>
                <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto ({decoded.encoding.toUpperCase()})</SelectItem>
                  <SelectItem value="utf-8">UTF-8</SelectItem>
                  <SelectItem value="utf-16le">UTF-16 LE</SelectItem>
                  <SelectItem value="utf-16be">UTF-16 BE</SelectItem>
                  <SelectItem value="gb18030">GB18030 / GBK</SelectItem>
                </SelectContent>
              </Select>

              <label className="pt-1.5 text-[10px] wb-muted">Delimiter</label>
              <div className="flex gap-1.5">
                <Select value={delimiterChoice} onValueChange={(value) => setDelimiterChoice(value as DelimiterChoice)} disabled={isLoading}>
                  <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto ({delimiter === "\t" ? "Tab" : delimiter})</SelectItem>
                    <SelectItem value="comma">Comma</SelectItem>
                    <SelectItem value="semicolon">Semicolon</SelectItem>
                    <SelectItem value="tab">Tab</SelectItem>
                    <SelectItem value="pipe">Pipe</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {delimiterChoice === "custom" && (
                  <input
                    aria-label="Custom delimiter"
                    className={`${fieldClass} w-12 text-center`}
                    value={customDelimiter}
                    maxLength={1}
                    onChange={(event) => setCustomDelimiter(event.target.value)}
                  />
                )}
              </div>

              <span className="text-[10px] wb-muted">Options</span>
              <div className="space-y-2 pt-0.5 text-[10px]">
                <label className="flex items-center gap-2">
                  <Checkbox checked={hasHeader} onCheckedChange={(value) => setHasHeader(value === true)} />
                  First row is header
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox checked={emptyAsNull} onCheckedChange={(value) => setEmptyAsNull(value === true)} />
                  Import empty fields as NULL
                </label>
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px] font-medium">
                <span>Column mapping</span>
                <span className="wb-muted">CSV → table</span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {mapping.map((item) => (
                  <div key={item.sourceIndex} className="grid grid-cols-[minmax(0,1fr)_14px_minmax(0,1fr)] items-center gap-1 py-1">
                    <span className="truncate rounded-[3px] bg-[hsl(var(--wb-editor))] px-2 py-1.5 font-mono text-[10px]" title={item.sourceName}>
                      {item.sourceName}
                    </span>
                    <span className="text-center text-[10px] wb-muted">→</span>
                    <Select value={item.targetColumn || "__ignore__"} onValueChange={(value) => updateMapping(item.sourceIndex, value)}>
                      <SelectTrigger aria-label={`Map ${item.sourceName}`} className={selectClass}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__ignore__">Ignore</SelectItem>
                        {columns.map((column) => (
                          <SelectItem key={column.name} value={column.name}>{column.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </section>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col bg-[hsl(var(--wb-editor))]">
            <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px]">
              <span className="font-medium">Data preview</span>
              <span className="wb-muted">
                {dataRecords.length.toLocaleString()} rows · {sourceColumns.length.toLocaleString()} columns
                {dataRecords.length > PREVIEW_ROW_LIMIT ? ` · first ${PREVIEW_ROW_LIMIT} shown` : ""}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[11px] wb-muted">
                  <Loader2 size={14} className="animate-spin" /> Reading {file?.name}
                </div>
              ) : (
                <table className="min-w-full border-collapse font-mono text-[10px]">
                  <thead className="sticky top-0 z-10 bg-[hsl(var(--wb-toolbar))]">
                    <tr>
                      <th className="w-12 border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-right font-normal wb-muted">#</th>
                      {sourceColumns.map((column, index) => (
                        <th key={`${column}-${index}`} className="min-w-32 whitespace-nowrap border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-left font-medium">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRecords.map((record, rowIndex) => (
                      <tr key={`${record.line}-${rowIndex}`} className="hover:bg-[hsl(var(--wb-hover))]">
                        <td className="border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-right wb-muted">{record.line}</td>
                        {sourceColumns.map((_, columnIndex) => (
                          <td key={columnIndex} className="max-w-80 whitespace-pre-wrap border-b border-r border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 align-top">
                            {record.values[columnIndex] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {(blockingError || plan.errorCount > 0) && (
              <section className="max-h-36 shrink-0 overflow-auto border-t border-red-500/25 bg-red-500/5 px-3 py-2 text-[10px] text-red-300" role="alert">
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <AlertCircle size={12} />
                  {blockingError ? "File could not be parsed" : `${plan.errorCount.toLocaleString()} validation error${plan.errorCount === 1 ? "" : "s"}`}
                </div>
                {blockingError ? (
                  <div>{blockingError}</div>
                ) : (
                  plan.issues.map((issue, index) => (
                    <div key={`${issue.line || 0}-${issue.targetColumn || ""}-${index}`} className="py-0.5">
                      {[issue.line ? `Line ${issue.line}` : null, issue.targetColumn].filter(Boolean).join(" · ")}
                      {(issue.line || issue.targetColumn) ? ": " : ""}{issue.message}
                    </div>
                  ))
                )}
                {plan.errorCount > plan.issues.length && (
                  <div className="pt-1 wb-muted">Only the first {plan.issues.length} errors are shown.</div>
                )}
              </section>
            )}
          </main>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <span className="text-[10px] wb-muted">
            {isNativeSource && decoded.encoding !== "utf-8"
              ? "This encoding uses the bounded decoded import path; native streaming accepts UTF-8 only."
              : "No rows are written until Import is confirmed. Database errors roll back the full batch."}
          </span>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[11px]" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[112px] justify-center px-3 text-[11px]"
              disabled={!canImport}
              onClick={() => void onImport(
                plan.rows,
                {
                  delimiter,
                  firstRowHeader: hasHeader,
                  columnMapping: mapping.map((item) => ({
                    sourceIndex: item.sourceIndex,
                    targetColumn: item.targetColumn,
                  })),
                  emptyFieldsAsNull: emptyAsNull,
                },
                decoded.encoding,
              )}
            >
              {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : `Import ${plan.rows.length.toLocaleString()} row${plan.rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
