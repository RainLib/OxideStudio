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
import { queryService } from "@/services/tauri/query.service";
import { useSchemaStore } from "@/store/useSchemaStore";

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

const COMMON_TYPES = [
  "INT",
  "VARCHAR",
  "TEXT",
  "DATE",
  "DATETIME",
  "BOOLEAN",
  "DECIMAL",
  "FLOAT",
];

const MYSQL_TYPES = [
  ...COMMON_TYPES,
  "TINYINT",
  "SMALLINT",
  "BIGINT",
  "DOUBLE",
  "BLOB",
  "JSON",
];

const POSTGRES_TYPES = [
  ...COMMON_TYPES,
  "INTEGER",
  "BIGINT",
  "SERIAL",
  "BIGSERIAL",
  "REAL",
  "DOUBLE PRECISION",
  "JSONB",
  "UUID",
];

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

  const { connections } = useConnectionStore();
  const { loadTables } = useSchemaStore();

  const connection = connections.find((c) => c.id === activeConnectionId);
  const driver = connection?.driver || "postgres";
  const typeOptions = driver === "mysql" ? MYSQL_TYPES : POSTGRES_TYPES;

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setTableName("");
      setColumns([
        {
          name: "id",
          type: driver === "mysql" ? "INT" : "SERIAL",
          length: "",
          isPrimaryKey: true,
          isNotNull: true,
          isAutoIncrement: true,
        },
      ]);
      setError(null);
    }
  }, [isOpen, driver]);

  const addColumn = () => {
    setColumns([
      ...columns,
      {
        name: "",
        type: "VARCHAR",
        length: "255",
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
    setColumns(newColumns);
  };

  const generateSQL = () => {
    const quote = driver === "mysql" ? "`" : '"';
    // const schemaPrefix = currentSchema ? `${quote}${currentSchema}${quote}.` : "";

    const lines = [];
    const pkColumns = [];

    for (const col of columns) {
      let line = `${quote}${col.name}${quote} ${col.type}`;

      if (col.length && ["VARCHAR", "CHAR", "DECIMAL"].includes(col.type)) {
        line += `(${col.length})`;
      }

      // Auto Increment handling
      if (col.isAutoIncrement) {
        if (driver === "mysql") {
          line += " AUTO_INCREMENT";
        } else if (driver === "postgres") {
          // For Postgres, usually use SERIAL type instead of AUTO_INCREMENT, handled in defaults?
          // If user explicitly selected INT and checked AI, might be tricky in standard SQL.
          // Simplest for Postgres is usually SERIAL.
          // If user kept INT + AI, we might ignore AI or change type to SERIAL?
          // Let's assuming UI guides them to SERIAL for now or we map it.
          if (col.type === "INT" || col.type === "INTEGER") {
            // Replace type with SERIAL for simple AI logic logic if we wanted strictly AI
            // But let's stick to what user selected.
            // Postgres 'GENERATED ALWAYS AS IDENTITY' is modern way for others.
          }
        }
      }

      if (col.isNotNull) {
        line += " NOT NULL";
      }

      if (col.isPrimaryKey) {
        pkColumns.push(col.name);
      }

      lines.push(line);
    }

    if (pkColumns.length > 0) {
      lines.push(
        `PRIMARY KEY (${pkColumns
          .map((c) => `${quote}${c}${quote}`)
          .join(", ")})`
      );
    }

    return `CREATE TABLE ${quote}${tableName}${quote} (\n  ${lines.join(
      ",\n  "
    )}\n);`;
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
      const sql = generateSQL();
      console.log("Creating table with SQL:", sql);

      await queryService.executeQuery(
        activeConnectionId,
        sql,
        currentSchema || undefined
      );

      // Refresh tables
      if (currentSchema) {
        await loadTables(activeConnectionId, currentSchema);
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
      <DialogContent className="max-w-[700px] bg-[#18181b] text-foreground border-white/10 max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-white/5">
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
              className="bg-[#27272a] border-white/10"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Columns
              </label>
            </div>

            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 bg-[#27272a]/50 p-2 rounded border border-white/5"
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
                        className="h-8 text-xs bg-[#18181b]"
                      />
                    </div>
                    {/* Type */}
                    <div className="col-span-3">
                      <Select
                        value={col.type}
                        onValueChange={(val) => updateColumn(idx, "type", val)}
                      >
                        <SelectTrigger className="h-8 text-xs bg-[#18181b]">
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
                        className="h-8 text-xs bg-[#18181b]"
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
                          onCheckedChange={(c) =>
                            updateColumn(idx, "isAutoIncrement", !!c)
                          }
                        />
                        <label
                          htmlFor={`ai-${idx}`}
                          className="text-[10px] cursor-pointer"
                          title="Auto Increment"
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
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addColumn}
              className="w-full border-dashed border-white/20 hover:bg-[#27272a]"
            >
              <Plus size={14} className="mr-2" /> Add Column
            </Button>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-white/5 bg-[#27272a]/30">
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
