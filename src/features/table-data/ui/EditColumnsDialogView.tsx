import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EditColumnsDialogController } from "@/features/table-data/hooks/useEditColumnsDialogController";
import { formatColumnFlags } from "@/features/table-data/model/editColumnsDialog";
import type { AlterColumnValueMode } from "@/services/tauri/types";
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";

interface EditColumnsDialogViewProps {
  controller: EditColumnsDialogController;
}

export function EditColumnsDialogView({
  controller,
}: EditColumnsDialogViewProps) {
  const {
    isOpen,
    onClose,
    schema,
    tableName,
    error,
    isLoading,
    columns,
    alteringColumn,
    renamingColumn,
    droppingColumn,
    isSubmitting,
    handleStartAlterColumn,
    handleRenameColumn,
    handleDropColumn,
    alterDraft,
    setAlterDraft,
    alterTypeOptions,
    updateAlterDraft,
    handleAlterColumn,
    draft,
    updateDraft,
    capabilities,
    draftAutoIncrementSupported,
    handleAddColumn,
  } = controller;
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent layout="custom" className="flex max-h-[82vh] w-[780px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <DialogTitle className="text-[13px] font-semibold">Edit Columns</DialogTitle>
          <div className="truncate font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
            {schema}.{tableName}
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {error && (
            <div className="rounded-[4px] border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive" role="alert">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
              Existing Columns
            </div>
            <div className="overflow-hidden rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]">
              {isLoading ? (
                <div className="p-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
                  Loading columns...
                </div>
              ) : columns.length === 0 ? (
                <div className="p-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
                  No columns loaded
                </div>
              ) : (
                columns.map((column) => (
                  <div
                    key={column.name}
                    className="grid grid-cols-[minmax(140px,1fr)_minmax(120px,1fr)_minmax(120px,auto)_96px] items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 last:border-b-0 hover:bg-[hsl(var(--wb-hover))]"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">
                        {column.name}
                      </div>
                      {column.comment && (
                        <div className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                          {column.comment}
                        </div>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[hsl(var(--wb-text-muted))]">
                      {column.data_type}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {formatColumnFlags(column).map((flag) => (
                        <span
                          key={flag}
                          className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--wb-text-muted))]"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]"
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
                        className="h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]"
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
                        className="h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:text-destructive"
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
            <div className="space-y-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
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
                    <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-xs">
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
                  className="col-span-2 h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-xs"
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
                    <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-xs">
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
                  className="col-span-4 h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-xs disabled:opacity-50"
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
                    <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-xs">
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
                  className="col-span-6 h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-xs disabled:opacity-50"
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
            <div className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
              Add Column
            </div>
            <div className="grid grid-cols-12 gap-2 items-center">
              <Input
                value={draft.name}
                onChange={(e) => updateDraft("name", e.target.value)}
                placeholder="Column name"
                className="col-span-3 h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] text-xs"
              />
              <div className="col-span-2">
                <Select
                  value={draft.type}
                  onValueChange={(value) => updateDraft("type", value)}
                >
                  <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] text-xs">
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
                className="col-span-2 h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] text-xs"
              />
              <Input
                value={draft.comment}
                onChange={(e) => updateDraft("comment", e.target.value)}
                placeholder="Comment"
                className="col-span-2 h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] text-xs"
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

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.56)] px-4 py-2.5">
          <Button className="h-7 text-[11px]" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Close
          </Button>
          <Button className="h-7 text-[11px]" onClick={handleAddColumn} disabled={isSubmitting}>
            <Plus size={14} className="mr-2" />
            {isSubmitting ? "Adding..." : "Add Column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
