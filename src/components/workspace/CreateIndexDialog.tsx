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
      <DialogContent className="w-[520px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <DialogTitle className="text-[13px] font-semibold">Create Index</DialogTitle>
          <div className="truncate font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
            {tableName}
          </div>
        </DialogHeader>

        <div className="space-y-4 p-4">
          {error && (
            <div className="rounded-[4px] border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive" role="alert">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
              Index Name
            </label>
            <Input
              value={indexName}
              onChange={(event) => setIndexName(event.target.value)}
              className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] font-mono text-[11px]"
            />
          </div>

          <label className="flex items-center gap-2 text-[11px] text-[hsl(var(--wb-text))]">
            <Checkbox
              checked={unique}
              onCheckedChange={(checked) => setUnique(!!checked)}
            />
            Unique index
          </label>

          <div className="space-y-2">
            <div className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
              Columns
            </div>
            <div className="max-h-56 overflow-auto rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]">
              {columns.length === 0 ? (
                <div className="p-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
                  No columns loaded
                </div>
              ) : (
                columns.map((column) => (
                  <label
                    key={column.name}
                    className="flex items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-[11px] last:border-b-0 hover:bg-[hsl(var(--wb-hover))]"
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
                    <span className="shrink-0 font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
                      {column.data_type}
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.56)] px-4 py-2.5">
          <Button className="h-7 text-[11px]" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button className="h-7 text-[11px]" onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Index"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
