import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { schemaService } from "@/services/tauri";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  ColumnInfo,
  DatabaseDriver,
  TableInfo,
} from "@/services/tauri/types";

type ConstraintMode = "foreignKey" | "unique" | "primaryKey" | "check";

interface CreateConstraintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
  tableName: string;
  columns: ColumnInfo[];
  isSubmitting?: boolean;
  supportsForeignKeys?: boolean;
  supportsCheckConstraints?: boolean;
  onCreateUnique: (constraintName: string, columns: string[]) => void;
  onCreatePrimaryKey: (constraintName: string, columns: string[]) => void;
  onCreateCheck: (constraintName: string, expression: string) => void;
  onCreateForeignKey: (request: {
    constraintName: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete: string | null;
    onUpdate: string | null;
  }) => void;
}

const referentialActions = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"];

function sanitizeName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function uniqueConstraintName(tableName: string, columns: string[]) {
  return sanitizeName([tableName, ...columns, "key"].filter(Boolean).join("_"));
}

function primaryKeyConstraintName(tableName: string) {
  return sanitizeName([tableName, "pkey"].filter(Boolean).join("_"));
}

function checkConstraintName(tableName: string) {
  return sanitizeName([tableName, "check"].filter(Boolean).join("_"));
}

function foreignKeyConstraintName(tableName: string, column: string) {
  return sanitizeName([tableName, column, "fkey"].filter(Boolean).join("_"));
}

function constraintNameForMode(
  mode: ConstraintMode,
  tableName: string,
  columns: string[]
) {
  if (mode === "unique") {
    return uniqueConstraintName(tableName, columns);
  }
  if (mode === "primaryKey") {
    return primaryKeyConstraintName(tableName);
  }
  if (mode === "check") {
    return checkConstraintName(tableName);
  }
  return foreignKeyConstraintName(tableName, columns[0] || "");
}

export function CreateConstraintDialog({
  isOpen,
  onClose,
  connectionId,
  driver,
  schema,
  tableName,
  columns,
  isSubmitting = false,
  supportsForeignKeys = true,
  supportsCheckConstraints = true,
  onCreateUnique,
  onCreatePrimaryKey,
  onCreateCheck,
  onCreateForeignKey,
}: CreateConstraintDialogProps) {
  const [mode, setMode] = useState<ConstraintMode>("foreignKey");
  const [constraintName, setConstraintName] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [referencedTables, setReferencedTables] = useState<TableInfo[]>([]);
  const [referencedTable, setReferencedTable] = useState("");
  const [referencedColumns, setReferencedColumns] = useState<ColumnInfo[]>([]);
  const [referencedColumnMap, setReferencedColumnMap] = useState<
    Record<string, string>
  >({});
  const [onDelete, setOnDelete] = useState("NO ACTION");
  const [onUpdate, setOnUpdate] = useState("NO ACTION");
  const [checkExpression, setCheckExpression] = useState("");
  const [error, setError] = useState<string | null>(null);

  const indexableColumns = useMemo(
    () => columns.filter((column) => !column.is_primary_key),
    [columns]
  );
  const firstColumn = indexableColumns[0]?.name || columns[0]?.name || "";
  const availableModes = useMemo<ConstraintMode[]>(
    () => [
      ...(supportsForeignKeys ? (["foreignKey"] as ConstraintMode[]) : []),
      "unique",
      "primaryKey",
      ...(supportsCheckConstraints ? (["check"] as ConstraintMode[]) : []),
    ],
    [supportsCheckConstraints, supportsForeignKeys]
  );
  const defaultMode = availableModes[0] || "unique";

  useEffect(() => {
    if (!isOpen) return;

    const initialColumns = firstColumn ? [firstColumn] : [];
    const initialMode = defaultMode;
    setMode(initialMode);
    setSelectedColumns(initialColumns);
    setConstraintName(
      constraintNameForMode(initialMode, tableName, initialColumns)
    );
    setReferencedTable("");
    setReferencedColumns([]);
    setReferencedColumnMap({});
    setOnDelete("NO ACTION");
    setOnUpdate("NO ACTION");
    setCheckExpression("");
    setError(null);

    if (supportsForeignKeys && connectionId && schema) {
      schemaService
        .getTables(connectionId, schema)
        .then(setReferencedTables)
        .catch((err) => {
          setError(err?.message || String(err));
          setReferencedTables([]);
        });
    }
  }, [
    isOpen,
    connectionId,
    schema,
    tableName,
    firstColumn,
    defaultMode,
    supportsForeignKeys,
  ]);

  useEffect(() => {
    if (!isOpen || !connectionId || !schema || !referencedTable) return;

    loadTableMetadata({
      connectionId,
      driver,
      schema,
      table: referencedTable,
      includeIndexes: false,
      includeConstraints: false,
    })
      .then((metadata) => {
        setReferencedColumns(metadata.columns);
      })
      .catch((err) => {
        setError(err?.message || String(err));
        setReferencedColumns([]);
        setReferencedColumnMap({});
      });
  }, [isOpen, connectionId, driver, schema, referencedTable]);

  useEffect(() => {
    if (!isOpen || mode !== "foreignKey") return;

    setReferencedColumnMap((current) => {
      const next: Record<string, string> = {};
      selectedColumns.forEach((columnName, index) => {
        const currentValue = current[columnName];
        const currentStillExists = referencedColumns.some(
          (column) => column.name === currentValue
        );
        const matchingColumn = referencedColumns.find(
          (column) => column.name === columnName
        );
        const indexedColumn = referencedColumns[index];
        const primaryKey = referencedColumns.find(
          (column) => column.is_primary_key
        );
        next[columnName] =
          currentStillExists && currentValue
            ? currentValue
            : matchingColumn?.name ||
              indexedColumn?.name ||
              primaryKey?.name ||
              referencedColumns[0]?.name ||
              "";
      });
      return next;
    });
  }, [isOpen, mode, referencedColumns, selectedColumns]);

  const setModeAndName = (nextMode: ConstraintMode) => {
    if (!availableModes.includes(nextMode)) return;
    setMode(nextMode);
    setConstraintName(
      constraintNameForMode(nextMode, tableName, selectedColumns)
    );
  };

  const toggleColumn = (columnName: string, checked: boolean) => {
    setSelectedColumns((current) => {
      const next = checked
        ? [...current, columnName]
        : current.filter((column) => column !== columnName);
      if (mode === "unique") {
        setConstraintName(uniqueConstraintName(tableName, next));
      } else if (mode === "foreignKey") {
        setConstraintName(foreignKeyConstraintName(tableName, next[0] || ""));
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const name = constraintName.trim();
    if (!availableModes.includes(mode)) {
      setError("Selected constraint type is not supported by this driver");
      return;
    }
    if (!name) {
      setError("Constraint name is required");
      return;
    }
    if (mode === "check") {
      const expression = checkExpression.trim();
      if (!expression) {
        setError("Check expression is required");
        return;
      }
      setError(null);
      onCreateCheck(name, expression);
      return;
    }
    if (selectedColumns.length === 0) {
      setError("Select at least one column");
      return;
    }

    setError(null);
    if (mode === "primaryKey") {
      onCreatePrimaryKey(name, selectedColumns);
      return;
    }
    if (mode === "unique") {
      onCreateUnique(name, selectedColumns);
      return;
    }

    if (!supportsForeignKeys) {
      setError("Foreign keys are not supported by this driver");
      return;
    }

    const mappedReferencedColumns = selectedColumns.map(
      (column) => referencedColumnMap[column] || ""
    );
    if (
      !referencedTable ||
      mappedReferencedColumns.some((column) => !column)
    ) {
      setError("Referenced table and columns are required");
      return;
    }

    onCreateForeignKey({
      constraintName: name,
      columns: selectedColumns,
      referencedTable,
      referencedColumns: mappedReferencedColumns,
      onDelete,
      onUpdate,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent layout="custom" className="w-[560px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] p-4">
          <DialogTitle>Create Constraint</DialogTitle>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {schema}.{tableName}
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-xs p-2 rounded border border-destructive/20">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Type
              </label>
              <Select value={mode} onValueChange={(value) => setModeAndName(value as ConstraintMode)}>
                <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportsForeignKeys && (
                    <SelectItem value="foreignKey">Foreign Key</SelectItem>
                  )}
                  <SelectItem value="unique">Unique</SelectItem>
                  <SelectItem value="primaryKey">Primary Key</SelectItem>
                  {supportsCheckConstraints && (
                    <SelectItem value="check">Check</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Constraint Name
              </label>
              <Input
                value={constraintName}
                onChange={(event) => setConstraintName(event.target.value)}
                className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] font-mono text-xs"
              />
            </div>
          </div>

          {mode !== "check" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Local Columns
              </div>
              <div className="max-h-40 overflow-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
                {columns.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    No columns loaded
                  </div>
                ) : (
                  columns.map((column) => (
                    <label
                      key={column.name}
                      className="flex items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-xs last:border-b-0 hover:bg-[hsl(var(--wb-hover))]"
                    >
                      <Checkbox
                        checked={selectedColumns.includes(column.name)}
                        onCheckedChange={(checked) => {
                          toggleColumn(column.name, !!checked);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {column.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground font-mono">
                        {column.data_type}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {mode === "check" && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Check Expression
              </label>
              <Input
                value={checkExpression}
                onChange={(event) => setCheckExpression(event.target.value)}
                placeholder="amount >= 0"
                className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] font-mono text-xs"
              />
            </div>
          )}

          {mode === "foreignKey" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Referenced Table
                </label>
                <Select value={referencedTable} onValueChange={setReferencedTable}>
                  <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                    <SelectValue placeholder="Select table" />
                  </SelectTrigger>
                  <SelectContent>
                    {referencedTables.map((table) => (
                      <SelectItem key={table.name} value={table.name}>
                        {table.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Column Mapping
                </label>
                <div className="max-h-32 overflow-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
                  {selectedColumns.length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">
                      Select local columns
                    </div>
                  ) : (
                    selectedColumns.map((columnName) => (
                      <div
                        key={columnName}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 last:border-b-0"
                      >
                        <span className="truncate font-mono text-xs">
                          {columnName}
                        </span>
                        <Select
                          value={referencedColumnMap[columnName] || ""}
                          onValueChange={(value) =>
                            setReferencedColumnMap((current) => ({
                              ...current,
                              [columnName]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-7 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                            <SelectValue placeholder="Column" />
                          </SelectTrigger>
                          <SelectContent>
                            {referencedColumns.map((column) => (
                              <SelectItem key={column.name} value={column.name}>
                                {column.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  On Delete
                </label>
                <Select value={onDelete} onValueChange={setOnDelete}>
                  <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {referentialActions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  On Update
                </label>
                <Select value={onUpdate} onValueChange={setOnUpdate}>
                  <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {referentialActions.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] p-4">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Constraint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
