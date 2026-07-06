import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import type {
  AlterColumnValueMode,
  ColumnInfo,
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";
import {
  defaultDatabaseCapabilities,
  defaultLengthForDataType,
  defaultStringDataType,
  supportsAutoIncrementForDataType,
} from "@/lib/databaseDialect";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";

interface EditColumnsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
  tableName: string;
}

interface ColumnDraft {
  name: string;
  type: string;
  length: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
  comment: string;
}

interface AlterColumnDraft {
  name: string;
  type: string;
  length: string;
  originalType: string;
  originalLength: string;
  isNotNull: boolean;
  originalIsNotNull: boolean;
  defaultMode: AlterColumnValueMode;
  defaultValue: string;
  commentMode: AlterColumnValueMode;
  comment: string;
}

function createDefaultDraft(capabilities: DatabaseCapabilities): ColumnDraft {
  const dataType = defaultStringDataType(capabilities);

  return {
    name: "",
    type: dataType,
    length: defaultLengthForDataType(dataType),
    isPrimaryKey: false,
    isNotNull: false,
    isAutoIncrement: false,
    comment: "",
  };
}

function lengthForType(type: string, currentLength = "") {
  const defaultLength = defaultLengthForDataType(type);
  if (!defaultLength) return "";
  return currentLength || defaultLength;
}

function parseColumnType(
  rawType: string,
  capabilities: DatabaseCapabilities
): { type: string; length: string } {
  const raw = rawType.trim();
  const normalized = raw.toUpperCase();
  const candidates = [...capabilities.commonDataTypes].sort(
    (a, b) => b.length - a.length
  );
  const aliases: Record<string, string> = {
    "CHARACTER VARYING": "VARCHAR",
    CHARACTER: "CHAR",
    INTEGER: capabilities.commonDataTypes.includes("INT") ? "INT" : "INTEGER",
  };

  let selected = candidates.find((type) => {
    const upper = type.toUpperCase();
    return (
      normalized === upper ||
      normalized.startsWith(`${upper}(`) ||
      normalized.startsWith(`${upper} `)
    );
  });

  if (!selected) {
    const alias = Object.entries(aliases).find(([from]) => {
      return (
        normalized === from ||
        normalized.startsWith(`${from}(`) ||
        normalized.startsWith(`${from} `)
      );
    });
    selected = alias?.[1];
  }

  if (!selected || !capabilities.commonDataTypes.includes(selected)) {
    selected = capabilities.commonDataTypes[0] || capabilities.defaultPrimaryKeyType;
  }

  const length = raw.match(/\(([^)]*)\)/)?.[1]?.trim() || "";
  return { type: selected, length };
}

function createAlterDraft(
  column: ColumnInfo,
  capabilities: DatabaseCapabilities
): AlterColumnDraft {
  const parsed = parseColumnType(column.data_type, capabilities);
  return {
    name: column.name,
    type: parsed.type,
    length: parsed.length,
    originalType: parsed.type,
    originalLength: parsed.length,
    isNotNull: !column.is_nullable,
    originalIsNotNull: !column.is_nullable,
    defaultMode: "keep",
    defaultValue: column.default_value || "",
    commentMode: "keep",
    comment: column.comment || "",
  };
}

function formatColumnFlags(column: ColumnInfo) {
  const flags = [];
  if (column.is_primary_key) flags.push("PK");
  if (!column.is_nullable) flags.push("NN");
  if (column.is_unique) flags.push("UQ");
  if (column.is_indexed) flags.push("IDX");
  if (column.is_auto_increment) flags.push("AI");
  return flags;
}

export function EditColumnsDialog({
  isOpen,
  onClose,
  connectionId,
  driver,
  schema,
  tableName,
}: EditColumnsDialogProps) {
  const fallbackCapabilities = defaultDatabaseCapabilities(driver);
  const [capabilities, setCapabilities] =
    useState<DatabaseCapabilities>(fallbackCapabilities);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [draft, setDraft] = useState<ColumnDraft>(
    createDefaultDraft(fallbackCapabilities)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [droppingColumn, setDroppingColumn] = useState<string | null>(null);
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null);
  const [alterDraft, setAlterDraft] = useState<AlterColumnDraft | null>(null);
  const [alteringColumn, setAlteringColumn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loadTables, bumpMetadataVersion } = useSchemaStore();
  const { refreshTableTabs } = useTabStore();
  const draftAutoIncrementSupported = supportsAutoIncrementForDataType(
    capabilities,
    draft.type
  );

  const loadColumns = async () => {
    if (!connectionId || !schema || !tableName) return;

    setIsLoading(true);
    setError(null);
    try {
      const loadedColumns = await schemaService.getColumns(
        connectionId,
        schema,
        tableName
      );
      setColumns(loadedColumns);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const refreshAfterColumnChange = async () => {
    await loadColumns();

    if (connectionId && schema && tableName) {
      await Promise.all([
        loadTables(connectionId, schema, true),
        refreshTableTabs(connectionId, schema, tableName),
      ]);
    }

    bumpMetadataVersion();
  };

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(driver);
    setCapabilities(fallback);
    setDraft(createDefaultDraft(fallback));
    setColumns([]);
    setAlterDraft(null);
    setError(null);

    databaseService
      .getDatabaseCapabilities(driver)
      .then((value) => {
        if (cancelled) return;
        setCapabilities(value);
        setDraft(createDefaultDraft(value));
      })
      .catch((err) => {
        console.error("Failed to load database capabilities:", err);
      });

    loadColumns();

    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId, driver, schema, tableName]);

  const updateDraft = (
    field: keyof ColumnDraft,
    value: string | boolean
  ) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "type" && typeof value === "string") {
        next.length = defaultLengthForDataType(value);
        if (!supportsAutoIncrementForDataType(capabilities, value)) {
          next.isAutoIncrement = false;
        }
      }
      return next;
    });
  };

  const updateAlterDraft = (
    field: keyof AlterColumnDraft,
    value: string | boolean
  ) => {
    setAlterDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === "type" && typeof value === "string") {
        next.length = lengthForType(value, next.length);
      }
      return next;
    });
  };

  const handleAddColumn = async () => {
    if (!draft.name.trim()) {
      setError("Column name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await tableService.addTableColumn(connectionId, driver, schema, tableName, {
        name: draft.name.trim(),
        dataType: draft.type,
        length: draft.length.trim() || null,
        isPrimaryKey: draft.isPrimaryKey,
        isNotNull: draft.isNotNull,
        isAutoIncrement: draft.isAutoIncrement,
        comment: draft.comment.trim() || null,
      });

      setDraft(createDefaultDraft(capabilities));
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDropColumn = async (columnName: string) => {
    const confirmed = window.confirm(
      `Drop column "${columnName}" from "${tableName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDroppingColumn(columnName);
    setError(null);
    try {
      await tableService.dropTableColumn(
        connectionId,
        driver,
        schema,
        tableName,
        columnName
      );
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDroppingColumn(null);
    }
  };

  const handleRenameColumn = async (columnName: string) => {
    const nextName = window.prompt("Rename column to:", columnName);
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === columnName) return;

    setRenamingColumn(columnName);
    setError(null);
    try {
      await tableService.renameTableColumn(
        connectionId,
        driver,
        schema,
        tableName,
        columnName,
        trimmedName
      );
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRenamingColumn(null);
    }
  };

  const handleStartAlterColumn = (column: ColumnInfo) => {
    setAlterDraft(createAlterDraft(column, capabilities));
    setError(null);
  };

  const handleAlterColumn = async () => {
    if (!alterDraft) return;

    const typeChanged =
      alterDraft.type !== alterDraft.originalType ||
      alterDraft.length.trim() !== alterDraft.originalLength;
    const notNullChanged =
      alterDraft.isNotNull !== alterDraft.originalIsNotNull;

    setAlteringColumn(alterDraft.name);
    setError(null);
    try {
      await tableService.alterTableColumn(
        connectionId,
        driver,
        schema,
        tableName,
        {
          name: alterDraft.name,
          dataType: typeChanged ? alterDraft.type : null,
          length: typeChanged ? alterDraft.length.trim() || null : null,
          isNotNull: notNullChanged ? alterDraft.isNotNull : null,
          defaultMode:
            alterDraft.defaultMode === "keep" ? null : alterDraft.defaultMode,
          defaultValue:
            alterDraft.defaultMode === "set"
              ? alterDraft.defaultValue.trim()
              : null,
          commentMode:
            alterDraft.commentMode === "keep" ? null : alterDraft.commentMode,
          comment:
            alterDraft.commentMode === "set" ? alterDraft.comment : null,
        }
      );
      setAlterDraft(null);
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setAlteringColumn(null);
    }
  };

  const alterTypeOptions =
    alterDraft && !capabilities.commonDataTypes.includes(alterDraft.type)
      ? [alterDraft.type, ...capabilities.commonDataTypes]
      : capabilities.commonDataTypes;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[780px] bg-[#18181b] text-foreground border-white/10 max-h-[82vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-white/5">
          <DialogTitle>Edit Columns</DialogTitle>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {schema}.{tableName}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-xs p-2 rounded border border-destructive/20">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Existing Columns
            </div>
            <div className="border border-white/10 rounded-sm overflow-hidden">
              {isLoading ? (
                <div className="p-3 text-xs text-muted-foreground">
                  Loading columns...
                </div>
              ) : columns.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">
                  No columns loaded
                </div>
              ) : (
                columns.map((column) => (
                  <div
                    key={column.name}
                    className="grid grid-cols-[minmax(140px,1fr)_minmax(120px,1fr)_minmax(120px,auto)_96px] items-center gap-2 px-3 py-2 border-b border-white/5 last:border-b-0 bg-[#27272a]/30"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">
                        {column.name}
                      </div>
                      {column.comment && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {column.comment}
                        </div>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground truncate">
                      {column.data_type}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {formatColumnFlags(column).map((flag) => (
                        <span
                          key={flag}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-background-tertiary text-muted-foreground border border-white/10"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleStartAlterColumn(column)}
                        disabled={
                          !!alteringColumn ||
                          !!renamingColumn ||
                          !!droppingColumn ||
                          isSubmitting
                        }
                        title="Alter column"
                      >
                        <Settings2 size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => handleRenameColumn(column.name)}
                        disabled={
                          !!renamingColumn ||
                          !!droppingColumn ||
                          !!alteringColumn ||
                          isSubmitting
                        }
                        title="Rename column"
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDropColumn(column.name)}
                        disabled={
                          !!droppingColumn ||
                          !!renamingColumn ||
                          !!alteringColumn ||
                          isSubmitting
                        }
                        title="Drop column"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {alterDraft && (
            <div className="space-y-2 border border-white/10 rounded-sm p-3 bg-[#27272a]/30">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Alter Column
                  </div>
                  <div className="font-mono text-xs">{alterDraft.name}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setAlterDraft(null)}
                  disabled={!!alteringColumn}
                >
                  Cancel
                </Button>
              </div>
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3">
                  <Select
                    value={alterDraft.type}
                    onValueChange={(value) => updateAlterDraft("type", value)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-[#18181b] border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {alterTypeOptions.map((type) => (
                        <SelectItem key={type} value={type} className="text-xs">
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={alterDraft.length}
                  onChange={(e) => updateAlterDraft("length", e.target.value)}
                  placeholder="Length"
                  className="col-span-2 h-8 text-xs bg-[#18181b] border-white/10"
                />
                <label className="col-span-1 flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={alterDraft.isNotNull}
                    onCheckedChange={(checked) =>
                      updateAlterDraft("isNotNull", !!checked)
                    }
                  />
                  NN
                </label>
                <div className="col-span-2">
                  <Select
                    value={alterDraft.defaultMode}
                    onValueChange={(value) =>
                      updateAlterDraft(
                        "defaultMode",
                        value as AlterColumnValueMode
                      )
                    }
                  >
                    <SelectTrigger className="h-8 text-xs bg-[#18181b] border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep" className="text-xs">
                        Keep default
                      </SelectItem>
                      <SelectItem value="set" className="text-xs">
                        Set default
                      </SelectItem>
                      <SelectItem value="drop" className="text-xs">
                        Drop default
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={alterDraft.defaultValue}
                  onChange={(e) =>
                    updateAlterDraft("defaultValue", e.target.value)
                  }
                  placeholder="Default expression"
                  disabled={alterDraft.defaultMode !== "set"}
                  className="col-span-4 h-8 text-xs bg-[#18181b] border-white/10 disabled:opacity-50"
                />
              </div>
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3">
                  <Select
                    value={alterDraft.commentMode}
                    onValueChange={(value) =>
                      updateAlterDraft(
                        "commentMode",
                        value as AlterColumnValueMode
                      )
                    }
                  >
                    <SelectTrigger className="h-8 text-xs bg-[#18181b] border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep" className="text-xs">
                        Keep comment
                      </SelectItem>
                      <SelectItem value="set" className="text-xs">
                        Set comment
                      </SelectItem>
                      <SelectItem value="drop" className="text-xs">
                        Drop comment
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={alterDraft.comment}
                  onChange={(e) => updateAlterDraft("comment", e.target.value)}
                  placeholder="Comment"
                  disabled={alterDraft.commentMode !== "set"}
                  className="col-span-6 h-8 text-xs bg-[#18181b] border-white/10 disabled:opacity-50"
                />
                <Button
                  onClick={handleAlterColumn}
                  disabled={!!alteringColumn || isSubmitting}
                  className="col-span-3 h-8 text-xs"
                >
                  {alteringColumn ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Add Column
            </div>
            <div className="grid grid-cols-12 gap-2 items-center">
              <Input
                value={draft.name}
                onChange={(e) => updateDraft("name", e.target.value)}
                placeholder="Column name"
                className="col-span-3 h-8 text-xs bg-[#27272a] border-white/10"
              />
              <div className="col-span-2">
                <Select
                  value={draft.type}
                  onValueChange={(value) => updateDraft("type", value)}
                >
                  <SelectTrigger className="h-8 text-xs bg-[#27272a] border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {capabilities.commonDataTypes.map((type) => (
                      <SelectItem key={type} value={type} className="text-xs">
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={draft.length}
                onChange={(e) => updateDraft("length", e.target.value)}
                placeholder="Length"
                className="col-span-2 h-8 text-xs bg-[#27272a] border-white/10"
              />
              <Input
                value={draft.comment}
                onChange={(e) => updateDraft("comment", e.target.value)}
                placeholder="Comment"
                className="col-span-2 h-8 text-xs bg-[#27272a] border-white/10"
              />
              <div className="col-span-3 flex items-center gap-2 h-8">
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={draft.isPrimaryKey}
                    onCheckedChange={(checked) =>
                      updateDraft("isPrimaryKey", !!checked)
                    }
                  />
                  PK
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={draft.isNotNull}
                    onCheckedChange={(checked) =>
                      updateDraft("isNotNull", !!checked)
                    }
                  />
                  NN
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={draft.isAutoIncrement}
                    disabled={!draftAutoIncrementSupported}
                    onCheckedChange={(checked) =>
                      updateDraft("isAutoIncrement", !!checked)
                    }
                  />
                  <span
                    className={
                      draftAutoIncrementSupported
                        ? ""
                        : "cursor-not-allowed opacity-50"
                    }
                    title={
                      draftAutoIncrementSupported
                        ? "Auto Increment"
                        : "Auto increment requires an integer-compatible type"
                    }
                  >
                    AI
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-white/5 bg-[#27272a]/30">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Close
          </Button>
          <Button onClick={handleAddColumn} disabled={isSubmitting}>
            <Plus size={14} className="mr-2" />
            {isSubmitting ? "Adding..." : "Add Column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
