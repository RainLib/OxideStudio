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
import type { ColumnInfo } from "@/services/tauri/types";

interface CreateIndexDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnInfo[];
  isSubmitting?: boolean;
  onCreate: (indexName: string, columns: string[], unique: boolean) => void;
}

function defaultIndexName(tableName: string, columns: string[]) {
  const parts = [tableName, ...columns, "idx"]
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return parts || "table_idx";
}

export function CreateIndexDialog({
  isOpen,
  onClose,
  tableName,
  columns,
  isSubmitting = false,
  onCreate,
}: CreateIndexDialogProps) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [indexName, setIndexName] = useState("");
  const [unique, setUnique] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableColumns = useMemo(
    () => columns.filter((column) => !column.is_primary_key),
    [columns]
  );

  useEffect(() => {
    if (!isOpen) return;

    const firstColumn = selectableColumns[0]?.name || columns[0]?.name || "";
    const initialColumns = firstColumn ? [firstColumn] : [];
    setSelectedColumns(initialColumns);
    setIndexName(defaultIndexName(tableName, initialColumns));
    setUnique(false);
    setError(null);
  }, [isOpen, tableName, columns, selectableColumns]);

  const toggleColumn = (columnName: string, checked: boolean) => {
    setSelectedColumns((current) => {
      const next = checked
        ? [...current, columnName]
        : current.filter((column) => column !== columnName);
      if (!indexName || indexName === defaultIndexName(tableName, current)) {
        setIndexName(defaultIndexName(tableName, next));
      }
      return next;
    });
  };

  const handleCreate = () => {
    const name = indexName.trim();
    if (!name) {
      setError("Index name is required");
      return;
    }
    if (selectedColumns.length === 0) {
      setError("Select at least one column");
      return;
    }

    setError(null);
    onCreate(name, selectedColumns, unique);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[520px] bg-[#18181b] text-foreground border-white/10 p-0 gap-0">
        <DialogHeader className="p-4 border-b border-white/5">
          <DialogTitle>Create Index</DialogTitle>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {tableName}
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-xs p-2 rounded border border-destructive/20">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Index Name
            </label>
            <Input
              value={indexName}
              onChange={(event) => setIndexName(event.target.value)}
              className="h-8 text-xs bg-[#27272a] border-white/10 font-mono"
            />
          </div>

          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={unique}
              onCheckedChange={(checked) => setUnique(!!checked)}
            />
            Unique index
          </label>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Columns
            </div>
            <div className="max-h-56 overflow-auto border border-white/10 rounded-sm">
              {columns.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  No columns loaded
                </div>
              ) : (
                columns.map((column) => (
                  <label
                    key={column.name}
                    className="flex items-center gap-2 px-3 py-2 border-b border-white/5 last:border-b-0 text-xs"
                  >
                    <Checkbox
                      checked={selectedColumns.includes(column.name)}
                      onCheckedChange={(checked) =>
                        toggleColumn(column.name, !!checked)
                      }
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
        </div>

        <DialogFooter className="p-4 border-t border-white/5 bg-[#27272a]/30">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Index"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
