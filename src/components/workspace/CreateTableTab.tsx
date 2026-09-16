import { useEffect, useState, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateTableColumnEditor } from "@/features/table-creation/ui/CreateTableColumnEditor";
import { CreateTableImportSource } from "@/features/table-creation/ui/CreateTableImportSource";
import { CreateTableSqlPreview } from "@/features/table-creation/ui/CreateTableSqlPreview";
import {
  importFormatForPath,
  importTableNameSuggestion,
} from "@/features/table-creation/model/importSource";
import type {
  CreateTableColumn,
  CreateTableColumnDragState,
  TableImportSource,
} from "@/features/table-creation/model/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  defaultLengthForDataType,
  defaultStringDataType,
  supportsAutoIncrementForDataType,
} from "@/lib/databaseDialect";
import { databaseService, tableService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { StatusBarPortal } from "./StatusBarPortal";

interface CreateTableTabProps {
  tabId: string;
  connectionId: string;
  schemaName: string;
}

export function CreateTableTab({
  tabId,
  connectionId,
  schemaName,
}: CreateTableTabProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<CreateTableColumn[]>([
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
  const [importSource, setImportSource] = useState<TableImportSource | null>(null);
  const [isInferringImport, setIsInferringImport] = useState(false);
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities | null>(
    null
  );
  const [dragState, setDragState] = useState<CreateTableColumnDragState>({ isDragging: false, dragIndex: null, hoverIndex: null });

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
    field: keyof CreateTableColumn,
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
  const handleDragStart = (e: MouseEvent, index: number) => {
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
      <div className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] p-4">
        <h2 className="text-lg font-medium">Create New Table</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Creating in {namespaceLabel}:{" "}
          <span className="font-mono text-primary">{schemaName}</span>
        </p>
      </div>

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

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Table Name
          </label>
          <Input
            value={tableName}
            onChange={(event) => setTableName(event.target.value)}
            placeholder="e.g. users"
            className="max-w-md border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))]"
          />
        </div>

        <CreateTableImportSource
          importSource={importSource}
          isSubmitting={isSubmitting}
          isInferringImport={isInferringImport}
          onClear={() => setImportSource(null)}
          onChoose={() => void handleInferImportSchema()}
        />

        <CreateTableColumnEditor
          columns={columns}
          typeOptions={typeOptions}
          capabilities={activeCapabilities}
          dragState={dragState}
          onAddColumn={addColumn}
          onRemoveColumn={removeColumn}
          onUpdateColumn={updateColumn}
          onDragStart={handleDragStart}
          onDragEnter={handleDragEnter}
          onDragEnd={handleDragEnd}
        />

        <CreateTableSqlPreview sql={previewSql} error={previewError} />
      </div>

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
