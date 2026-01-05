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
import { Plus, Trash2, GripVertical } from "lucide-react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { queryService } from "@/services/tauri/query.service";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { StatusBarPortal } from "./StatusBarPortal";

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
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    dragIndex: number | null;
    hoverIndex: number | null;
  }>({ isDragging: false, dragIndex: null, hoverIndex: null });

  const { connections } = useConnectionStore();
  const { loadTables } = useSchemaStore();
  const { closeTab, updateTabTitle } = useTabStore();

  const connection = connections.find((c) => c.id === connectionId);
  const driver = connection?.driver || "postgres";
  const typeOptions = driver === "mysql" ? MYSQL_TYPES : POSTGRES_TYPES;

  // Update default type based on driver
  useEffect(() => {
    setColumns([
      {
        name: "id",
        type: driver === "mysql" ? "INT" : "SERIAL",
        length: "",
        isPrimaryKey: true,
        isNotNull: true,
        isAutoIncrement: true,
        comment: "",
      },
    ]);
  }, [driver]);

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
      if (value === "DECIMAL") {
        newColumns[index]!.length = "10,2";
      } else if (value === "VARCHAR") {
        // Only set if empty or previous default
        if (!newColumns[index]!.length) newColumns[index]!.length = "255";
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

  const generateSQL = () => {
    const quote = driver === "mysql" ? "`" : '"';

    const lines = [];
    const pkColumns = [];

    for (const col of columns) {
      let line = `${quote}${col.name}${quote} ${col.type}`;

      if (col.length && ["VARCHAR", "CHAR", "DECIMAL"].includes(col.type)) {
        line += `(${col.length})`;
      }

      if (col.isAutoIncrement && driver === "mysql") {
        line += " AUTO_INCREMENT";
      }

      if (col.isNotNull) {
        line += " NOT NULL";
      }

      if (col.comment && driver === "mysql") {
        line += ` COMMENT '${col.comment.replace(/'/g, "\\'")}'`;
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

    let sql = `CREATE TABLE ${quote}${tableName}${quote} (\n  ${lines.join(
      ",\n  "
    )}\n);`;

    if (driver === "postgres") {
      const comments = columns
        .filter((c) => c.comment)
        .map(
          (c) =>
            `COMMENT ON COLUMN "${tableName}"."${
              c.name
            }" IS '${c.comment.replace(/'/g, "''")}';`
        );
      if (comments.length > 0) {
        sql += "\n\n" + comments.join("\n");
      }
    }

    return sql;
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

    try {
      const sql = generateSQL();
      console.log("Creating table with SQL:", sql);

      await queryService.executeQuery(connectionId, sql, schemaName);

      // Refresh tables
      await loadTables(connectionId, schemaName);

      setSuccess(true);
      updateTabTitle(tabId, `✓ ${tableName}`);

      // Close tab after 1.5 seconds
      setTimeout(() => {
        closeTab(tabId);
      }, 1500);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#18181b] text-foreground">
      {/* Header */}
      <div className="p-4 border-b border-white/5">
        <h2 className="text-lg font-medium">Create New Table</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Creating in database:{" "}
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
            ✓ Table created successfully! This tab will close shortly.
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
            className="bg-[#27272a] border-white/10 max-w-md"
          />
        </div>

        {/* Columns */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">
            Columns
          </label>

          <div className="space-y-2">
            {columns.map((col, idx) => (
              <div
                key={idx}
                onMouseEnter={() => handleDragEnter(idx)}
                onMouseUp={handleDragEnd}
                className={`flex items-start gap-2 bg-[#27272a]/50 p-3 rounded border transition-all ${
                  dragState.isDragging && dragState.dragIndex === idx
                    ? "opacity-50 border-primary/50"
                    : dragState.isDragging && dragState.hoverIndex === idx
                    ? "border-primary border-dashed"
                    : "border-white/5"
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
                      className="h-8 text-xs bg-[#18181b]"
                    />
                  </div>
                  {/* Type */}
                  <div className="col-span-2">
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
                      placeholder="Length"
                      className="h-8 text-xs bg-[#18181b]"
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
                      className="h-8 text-xs bg-[#18181b]"
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
                        onCheckedChange={(c) =>
                          updateColumn(idx, "isAutoIncrement", !!c)
                        }
                      />
                      <label
                        htmlFor={`ai-${idx}`}
                        className="text-xs cursor-pointer"
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
            className="border-dashed border-white/20 hover:bg-[#27272a]"
          >
            <Plus size={14} className="mr-2" /> Add Column
          </Button>
        </div>
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
            {isSubmitting ? "Creating..." : "Create Table"}
          </Button>
        </div>
      </StatusBarPortal>
    </div>
  );
}
