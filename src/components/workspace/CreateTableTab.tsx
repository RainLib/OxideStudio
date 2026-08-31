import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FileCode2, FileUp, Loader2, Plus, Trash2, GripVertical, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useConnectionStore } from "@/store/useConnectionStore";
import { databaseService, tableService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  TableCsvImportOptions,
  TableImportFormat,
} from "@/services/tauri";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { StatusBarPortal } from "./StatusBarPortal";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultLengthForDataType,
  defaultDatabaseCapabilities,
  defaultStringDataType,
  supportsAutoIncrementForDataType,
} from "@/lib/databaseDialect";

interface CreateTableTabProps {
  tabId: string;
  connectionId: string;
  schemaName: string;
}

interface ColumnDefinition {
  name: string;
  type: string;
  length: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
  comment: string;
}

interface InferredImportSource {
  filePath: string;
  format: TableImportFormat;
  contentDigest: string;
  totalRows: number;
  csvOptions?: TableCsvImportOptions | null;
}

function importFormatForPath(filePath: string): TableImportFormat | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (["csv", "tsv", "txt"].includes(extension || "")) return "csv";
  if (["json", "jsonl", "ndjson"].includes(extension || "")) return "json";
  if (extension === "xlsx") return "xlsx";
  return null;
}

function importTableNameSuggestion(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || "imported_data";
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "imported_data";
}

export function CreateTableTab({
  tabId,
  connectionId,
  schemaName,
}: CreateTableTabProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDefinition[]>([
    {
      name: "id",
      type: "INT",
      length: "",
      isPrimaryKey: true,
      isNotNull: true,
      isAutoIncrement: true,
      comment: "",
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [previewSql, setPreviewSql] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importSource, setImportSource] = useState<InferredImportSource | null>(null);
  const [isInferringImport, setIsInferringImport] = useState(false);
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities | null>(
    null
  );
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    dragIndex: number | null;
    hoverIndex: number | null;
  }>({ isDragging: false, dragIndex: null, hoverIndex: null });

  const { connections } = useConnectionStore();
  const { loadTables } = useSchemaStore();
  const { closeTab, updateTabTitle } = useTabStore();

  const connection = connections.find((c) => c.id === connectionId);
  const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
  const activeCapabilities =
    capabilities || defaultDatabaseCapabilities(driver);
  const typeOptions = activeCapabilities.commonDataTypes;
  const namespaceLabel = activeCapabilities.namespaceLabel || "database";

  useEffect(() => {
    let cancelled = false;
    setCapabilities(null);

    databaseService
      .getDatabaseCapabilities(driver, connection?.driverPackageVersion)
      .then((value) => {
        if (!cancelled) setCapabilities(value);
      })
      .catch((err) => {
        console.error("Failed to load database capabilities:", err);
        if (!cancelled) setCapabilities(defaultDatabaseCapabilities(driver));
      });

    return () => {
      cancelled = true;
    };
  }, [connection?.driverPackageVersion, driver]);

  // Update default type based on driver
  useEffect(() => {
    setColumns([
      {
        name: "id",
        type: activeCapabilities.defaultPrimaryKeyType,
        length: "",
        isPrimaryKey: true,
        isNotNull: true,
        isAutoIncrement: true,
        comment: "",
      },
    ]);
  }, [activeCapabilities.defaultPrimaryKeyType]);

  const handleInferImportSchema = async () => {
    if (isInferringImport || isSubmitting) return;
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: "Import data", extensions: ["csv", "tsv", "txt", "json", "jsonl", "ndjson", "xlsx"] },
      ],
    });
    if (typeof selected !== "string") return;
    const format = importFormatForPath(selected);
    if (!format) {
      setError("Choose a CSV, TSV, TXT, JSON, JSONL, NDJSON, or XLSX file.");
      return;
    }
    setIsInferringImport(true);
    setError(null);
    try {
      const inferred = await tableService.inferTableImportColumns(
        driver,
        selected,
        format,
      );
      setColumns(inferred.columns.map((column) => ({
        name: column.name,
        type: column.dataType,
        length: column.length || "",
        isPrimaryKey: false,
        isNotNull: false,
        isAutoIncrement: false,
        comment: "",
      })));
      setImportSource({
        filePath: selected,
        format,
        contentDigest: inferred.contentDigest,
        totalRows: inferred.totalRows,
        csvOptions: inferred.csvOptions,
      });
      if (!tableName.trim()) setTableName(importTableNameSuggestion(selected));
    } catch (cause) {
      setImportSource(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsInferringImport(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!tableName.trim() || columns.some((column) => !column.name.trim())) {
      setPreviewSql("");
      setPreviewError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void tableService
        .previewCreateTable(
          driver,
          schemaName,
          tableName,
          columns.map((column) => ({
            name: column.name,
            dataType: column.type,
            length: column.length || null,
            isPrimaryKey: column.isPrimaryKey,
            isNotNull: column.isNotNull,
            isAutoIncrement: column.isAutoIncrement,
            comment: column.comment || null,
          })),
        )
        .then((statements) => {
          if (cancelled) return;
          setPreviewSql(statements.join("\n\n"));
          setPreviewError(null);
        })
        .catch((cause) => {
          if (cancelled) return;
          setPreviewSql("");
          setPreviewError(cause instanceof Error ? cause.message : String(cause));
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [columns, driver, schemaName, tableName]);

  const addColumn = () => {
    const dataType = defaultStringDataType(activeCapabilities);
    setColumns([
      ...columns,
      {
        name: "",
        type: dataType,
        length: defaultLengthForDataType(dataType),
        isPrimaryKey: false,
        isNotNull: false,
        isAutoIncrement: false,
        comment: "",
      },
    ]);
  };

  const removeColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns(columns.filter((_, i) => i !== index));
    }
  };

  const updateColumn = (
    index: number,
    field: keyof ColumnDefinition,
    value: string | boolean
  ) => {
    const newColumns = [...columns];
    (newColumns[index] as any)[field] = value;

    // Set smart defaults when type changes
    if (field === "type") {
      const nextLength = defaultLengthForDataType(String(value));
      if (!nextLength) {
        newColumns[index]!.length = "";
      } else if (
        !newColumns[index]!.length ||
        newColumns[index]!.length === "255" ||
        newColumns[index]!.length === "10,2"
      ) {
        newColumns[index]!.length = nextLength;
      }
      if (!supportsAutoIncrementForDataType(activeCapabilities, String(value))) {
        newColumns[index]!.isAutoIncrement = false;
      }
    }

    setColumns(newColumns);
  };

  // Mouse-based drag handlers
  const handleDragStart = (e: React.MouseEvent, index: number) => {
    e.preventDefault(); // Prevent text selection
    setDragState({ isDragging: true, dragIndex: index, hoverIndex: null });

    // Add global mouseup listener to handle drop anywhere
    const handleGlobalMouseUp = () => {
      handleDragEnd();
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
    document.addEventListener("mouseup", handleGlobalMouseUp);
  };

  const handleDragEnter = (index: number) => {
    if (dragState.isDragging && dragState.dragIndex !== index) {
      setDragState({ ...dragState, hoverIndex: index });
    }
  };

  const handleDragEnd = () => {
    const { dragIndex, hoverIndex } = dragState;
    if (dragIndex !== null && hoverIndex !== null && dragIndex !== hoverIndex) {
      const newColumns = [...columns];
      const draggedItem = newColumns.splice(dragIndex, 1)[0];
      if (draggedItem) {
        newColumns.splice(hoverIndex, 0, draggedItem);
        setColumns(newColumns);
      }
    }
    setDragState({ isDragging: false, dragIndex: null, hoverIndex: null });
  };

  const handleCreate = async () => {
    if (!tableName.trim()) {
      setError("Table name is required");
      return;
    }
    if (columns.some((c) => !c.name.trim())) {
      setError("All columns must have a name");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(false);
    let tableCreated = false;

    try {
      await tableService.createTable(
        connectionId,
        driver,
        schemaName,
        tableName,
        columns.map((column) => ({
          name: column.name,
          dataType: column.type,
          length: column.length || null,
          isPrimaryKey: column.isPrimaryKey,
          isNotNull: column.isNotNull,
          isAutoIncrement: column.isAutoIncrement,
          comment: column.comment || null,
        }))
      );
      tableCreated = true;

      let importedRows: number | null = null;
      if (importSource) {
        try {
          const imported = await tableService.importTableData(
            connectionId,
            driver,
            schemaName,
            tableName,
            importSource.filePath,
            importSource.format,
            importSource.csvOptions?.firstRowHeader ?? true,
            undefined,
            importSource.csvOptions || undefined,
            importSource.contentDigest,
          );
          importedRows = imported.rowsImported;
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          throw new Error(
            `Table \"${tableName}\" was created, but no import rows were committed: ${detail}`,
          );
        }
      }

      // Refresh tables
      await loadTables(connectionId, schemaName, true);

      setSuccess(true);
      updateTabTitle(
        tabId,
        importedRows === null ? `Created ${tableName}` : `Imported ${tableName}`,
      );

      // Close tab after 1.5 seconds
      setTimeout(() => {
        closeTab(tabId);
      }, 1500);
    } catch (e: any) {
      // DDL is not transactional with every supported driver's import path.
      // If import failed after a successful create, surface the durable table
      // in Explorer immediately instead of leaving the user with a stale tree.
      if (tableCreated) {
        try {
          await loadTables(connectionId, schemaName, true);
        } catch {
          // The original create/import error is the actionable error here.
        }
      }
      setError(e.toString());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      {/* Header */}
      <div className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] p-4">
        <h2 className="text-lg font-medium">Create New Table</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Creating in {namespaceLabel}:{" "}
          <span className="font-mono text-primary">{schemaName}</span>
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="bg-destructive/10 text-destructive text-xs p-3 rounded border border-destructive/20">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-500/10 text-green-400 text-xs p-3 rounded border border-green-500/20">
            {importSource
              ? `${importSource.totalRows.toLocaleString()} reviewed row(s) were imported. This tab will close shortly.`
              : "Table created successfully. This tab will close shortly."}
          </div>
        )}

        {/* Table Name */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Table Name
          </label>
          <Input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            placeholder="e.g. users"
            className="max-w-md border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))]"
          />
        </div>

        <section className="rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <FileUp size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">Create from import file</div>
              <div className="truncate text-[11px] wb-muted">
                {importSource
                  ? `${importSource.filePath.split(/[\\/]/).pop()} · ${importSource.totalRows.toLocaleString()} reviewed rows · edit the inferred columns before creating`
                  : "Infer editable columns from CSV, JSON, or XLSX; creation is followed by a checked native import."}
              </div>
            </div>
            {importSource && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={() => setImportSource(null)}
                disabled={isSubmitting || isInferringImport}
                title="Use manual columns only"
              >
                <X size={14} />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleInferImportSchema()}
              disabled={isSubmitting || isInferringImport}
              className="h-8 shrink-0 text-xs"
            >
              {isInferringImport ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <FileUp size={13} className="mr-1.5" />}
              {importSource ? "Replace file" : "Choose file"}
            </Button>
          </div>
        </section>

        {/* Columns */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Columns
          </label>

          <div className="space-y-2">
            {columns.map((col, idx) => {
              const autoIncrementSupported = supportsAutoIncrementForDataType(
                activeCapabilities,
                col.type
              );
              return (
                <div
                key={idx}
                onMouseEnter={() => handleDragEnter(idx)}
                onMouseUp={handleDragEnd}
                className={`flex items-start gap-2 rounded-[5px] border bg-[hsl(var(--wb-panel))] p-3 transition-all ${
                  dragState.isDragging && dragState.dragIndex === idx
                    ? "opacity-50 border-primary/50"
                    : dragState.isDragging && dragState.hoverIndex === idx
                    ? "border-primary border-dashed"
                    : "border-[hsl(var(--wb-border-subtle))]"
                }`}
              >
                {/* Drag Handle */}
                <div
                  onMouseDown={(e) => handleDragStart(e, idx)}
                  className="h-8 w-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 select-none"
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </div>
                <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                  {/* Name */}
                  <div className="col-span-3">
                    <Input
                      value={col.name}
                      onChange={(e) =>
                        updateColumn(idx, "name", e.target.value)
                      }
                      placeholder="Column name"
                      className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                    />
                  </div>
                  {/* Type */}
                  <div className="col-span-2">
                    <Select
                      value={col.type}
                      onValueChange={(val) => updateColumn(idx, "type", val)}
                    >
                      <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {typeOptions.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Length */}
                  <div className="col-span-2">
                    <Input
                      value={col.length}
                      onChange={(e) =>
                        updateColumn(idx, "length", e.target.value)
                      }
                      placeholder="Length"
                      className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                    />
                  </div>
                  {/* Comment */}
                  <div className="col-span-2">
                    <Input
                      value={col.comment || ""}
                      onChange={(e) =>
                        updateColumn(idx, "comment", e.target.value)
                      }
                      placeholder="Comment"
                      className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                    />
                  </div>
                  {/* Options */}
                  <div className="col-span-3 flex items-center gap-2 px-2 h-8">
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={`pk-${idx}`}
                        checked={col.isPrimaryKey}
                        onCheckedChange={(c) =>
                          updateColumn(idx, "isPrimaryKey", !!c)
                        }
                      />
                      <label
                        htmlFor={`pk-${idx}`}
                        className="text-xs cursor-pointer"
                        title="Primary Key"
                      >
                        PK
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={`nn-${idx}`}
                        checked={col.isNotNull}
                        onCheckedChange={(c) =>
                          updateColumn(idx, "isNotNull", !!c)
                        }
                      />
                      <label
                        htmlFor={`nn-${idx}`}
                        className="text-xs cursor-pointer"
                        title="Not Null"
                      >
                        NN
                      </label>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={`ai-${idx}`}
                        checked={col.isAutoIncrement}
                        disabled={!autoIncrementSupported}
                        onCheckedChange={(c) =>
                          updateColumn(idx, "isAutoIncrement", !!c)
                        }
                      />
                      <label
                        htmlFor={`ai-${idx}`}
                        className={`text-xs ${
                          autoIncrementSupported
                            ? "cursor-pointer"
                            : "cursor-not-allowed opacity-50"
                        }`}
                        title={
                          autoIncrementSupported
                            ? "Auto Increment"
                            : "Auto increment requires an integer-compatible type"
                        }
                      >
                        AI
                      </label>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeColumn(idx)}
                  disabled={columns.length === 1}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={addColumn}
            className="border-dashed border-[hsl(var(--wb-border))] hover:bg-[hsl(var(--wb-hover))]"
          >
            <Plus size={14} className="mr-2" /> Add Column
          </Button>
        </div>

        <section className="overflow-hidden rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
          <div className="flex h-8 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3 text-[11px] font-medium">
            <FileCode2 size={13} className="text-[hsl(var(--wb-accent))]" />
            SQL preview
            <span className="ml-auto text-[9px] font-normal wb-muted">
              Generated by the active driver dialect
            </span>
          </div>
          <pre className="max-h-52 min-h-24 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))]">
            {previewError
              ? `Preview unavailable: ${previewError}`
              : previewSql ||
                "Enter a table name and complete every column name to generate SQL."}
          </pre>
        </section>
      </div>

      {/* Footer via Portal to status bar */}
      <StatusBarPortal>
        <div className="flex-1 flex items-center justify-end gap-2 px-4 h-full">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => closeTab(tabId)}
            disabled={isSubmitting}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={isSubmitting || success}
            className="h-8 text-xs"
          >
            {isSubmitting ? "Creating..." : importSource ? "Create and Import" : "Create Table"}
          </Button>
        </div>
      </StatusBarPortal>
    </div>
  );
}
