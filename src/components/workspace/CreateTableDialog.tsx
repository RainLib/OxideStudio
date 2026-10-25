import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Plus, Trash2 } from "lucide-react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { databaseService, tableService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri";
import { useSchemaStore } from "@/store/useSchemaStore";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultLengthForDataType,
  defaultDatabaseCapabilities,
  defaultStringDataType,
  supportsAutoIncrementForDataType,
} from "@/lib/databaseDialect";

interface CreateTableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnectionId: string;
  currentSchema: string | null;
}

interface ColumnDefinition {
  name: string;
  type: string;
  length: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
}

export function CreateTableDialog({
  isOpen,
  onClose,
  activeConnectionId,
  currentSchema,
}: CreateTableDialogProps) {
  const [tableName, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDefinition[]>([
    {
      name: "id",
      type: "INT",
      length: "",
      isPrimaryKey: true,
      isNotNull: true,
      isAutoIncrement: true,
    },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities | null>(
    null
  );

  const { connections } = useConnectionStore();
  const { loadTables } = useSchemaStore();

  const connection = connections.find((c) => c.id === activeConnectionId);
  const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
  const activeCapabilities =
    capabilities || defaultDatabaseCapabilities(driver);
  const typeOptions = activeCapabilities.commonDataTypes;

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

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setTableName("");
      setColumns([
        {
          name: "id",
          type: activeCapabilities.defaultPrimaryKeyType,
          length: "",
          isPrimaryKey: true,
          isNotNull: true,
          isAutoIncrement: true,
        },
      ]);
      setError(null);
    }
  }, [isOpen, activeCapabilities.defaultPrimaryKeyType]);

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
    // Cast value to any to satisfy the index signature valid for this specific update logic
    (newColumns[index] as any)[field] = value;
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

  const handleCreate = async () => {
    if (!tableName) {
      setError("Table name is required");
      return;
    }
    if (columns.some((c) => !c.name)) {
      setError("All columns must have a name");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await tableService.createTable(
        activeConnectionId,
        driver,
        currentSchema || "",
        tableName,
        columns.map((column) => ({
          name: column.name,
          dataType: column.type,
          length: column.length || null,
          isPrimaryKey: column.isPrimaryKey,
          isNotNull: column.isNotNull,
          isAutoIncrement: column.isAutoIncrement,
          comment: null,
        }))
      );

      // Refresh tables
      if (currentSchema) {
        await loadTables(activeConnectionId, currentSchema, true);
      }

      onClose();
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent layout="custom" className="flex max-h-[80vh] w-[700px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] p-4">
          <DialogTitle>Create New Table</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-xs p-2 rounded border border-destructive/20">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Table Name
            </label>
            <Input
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="e.g. users"
              className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Columns
              </label>
            </div>

            <div className="space-y-2">
              {columns.map((col, idx) => {
                const autoIncrementSupported = supportsAutoIncrementForDataType(
                  activeCapabilities,
                  col.type
                );
                return (
                  <div
                  key={idx}
                  className="flex items-start gap-2 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2"
                >
                  <div className="flex-1 grid grid-cols-12 gap-2">
                    {/* Name */}
                    <div className="col-span-3">
                      <Input
                        value={col.name}
                        onChange={(e) =>
                          updateColumn(idx, "name", e.target.value)
                        }
                        placeholder="Name"
                        className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                      />
                    </div>
                    {/* Type */}
                    <div className="col-span-3">
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
                        placeholder="Len"
                        className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                      />
                    </div>
                    {/* Options */}
                    <div className="col-span-4 flex items-center gap-3 px-2 h-8">
                      <div className="flex items-center gap-1">
                        <Checkbox
                          id={`pk-${idx}`}
                          checked={col.isPrimaryKey}
                          onCheckedChange={(c) =>
                            updateColumn(idx, "isPrimaryKey", !!c)
                          }
                        />
                        <label
                          htmlFor={`pk-${idx}`}
                          className="text-[10px] cursor-pointer"
                          title="Primary Key"
                        >
                          PK
                        </label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Checkbox
                          id={`nn-${idx}`}
                          checked={col.isNotNull}
                          onCheckedChange={(c) =>
                            updateColumn(idx, "isNotNull", !!c)
                          }
                        />
                        <label
                          htmlFor={`nn-${idx}`}
                          className="text-[10px] cursor-pointer"
                          title="Not Null"
                        >
                          NN
                        </label>
                      </div>
                      <div className="flex items-center gap-1">
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
                          className={`text-[10px] ${
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
              className="w-full border-dashed border-[hsl(var(--wb-border))] hover:bg-[hsl(var(--wb-hover))]"
            >
              <Plus size={14} className="mr-2" /> Add Column
            </Button>
          </div>
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] p-4">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Table"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
