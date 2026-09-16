import { type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  GitCompareArrows,
  KeyRound,
  Loader2,
  Plus,
  Redo2,
  Search,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DraftPersistenceState, SchemaStructuredDraftDialogProps } from "@/features/schema-diff/model/schemaStructuredDraftDialog";
import { useSchemaStructuredDraftDialog } from "@/features/schema-diff/hooks/useSchemaStructuredDraftDialog";

const inputClass =
  "h-7 min-w-0 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[9px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent)/0.65)] disabled:opacity-50";

export function SchemaStructuredDraftDialogView(props: SchemaStructuredDraftDialogProps) {
  const controller = useSchemaStructuredDraftDialog(props);
  const {
    open, snapshot, canvasHistory, selectedName, setSelectedName,
    relationFilter, setRelationFilter, newRelationName, setNewRelationName,
    relationName, setRelationName, pendingRelationDelete,
    columnName, setColumnName, columnType, setColumnType,
    columnNullable, setColumnNullable, columnPrimary, setColumnPrimary,
    columnUnique, setColumnUnique, columnDefault, setColumnDefault,
    columnComment, setColumnComment, editingColumnName,
    indexName, setIndexName, indexColumns, setIndexColumns, indexUnique, setIndexUnique,
    foreignKeyName, setForeignKeyName, foreignKeyColumns, setForeignKeyColumns,
    foreignKeyTarget, setForeignKeyTarget, foreignKeyTargetColumns, setForeignKeyTargetColumns,
    checkName, setCheckName, checkDefinition, setCheckDefinition,
    error, isReviewing, persistenceReady, persistenceState, persistenceNotice,
    lastSavedAt, pendingDiscard, selectedRelation, visibleRelations, hiddenRelationCount,
    draftRelations, dirty, createRelation, renameRelation, deleteRelation, saveColumn,
    resetColumnForm, closeWithPersist, discardDraft, reviewDiff, undo, redo,
    editColumn, removeColumn, addIndex, removeIndex, addForeignKey, addCheck, removeConstraint,
  } = controller;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void closeWithPersist();
      }}
    >
      <DialogContent className="grid h-[min(800px,calc(100vh-24px))] w-[min(1120px,calc(100vw-24px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <Table2 size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[13px] tracking-normal">
                Structured schema draft · {snapshot.schemaName}
              </DialogTitle>
              <DialogDescription className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                Project autosave · unified canvas undo/redo · review-only migration diff
              </DialogDescription>
            </div>
            <button
              type="button"
              className="wb-icon-button h-7 w-7"
              disabled={!persistenceReady || canvasHistory.past.length === 0 || isReviewing}
              onClick={undo}
              title="Undo canvas or draft action (Ctrl/Cmd+Z)"
            >
              <Undo2 size={12} />
            </button>
            <button
              type="button"
              className="wb-icon-button h-7 w-7"
              disabled={!persistenceReady || canvasHistory.future.length === 0 || isReviewing}
              onClick={redo}
              title="Redo canvas or draft action (Ctrl/Cmd+Shift+Z / Ctrl+Y)"
            >
              <Redo2 size={12} />
            </button>
          </div>
        </DialogHeader>

        <div
          className={cn(
            "grid min-h-0 grid-cols-[230px_minmax(0,1fr)] transition-opacity",
            !persistenceReady && "pointer-events-none opacity-60",
          )}
        >
          <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
            <div className="border-b border-[hsl(var(--wb-border-subtle))] p-2">
              <div className="relative">
                <Search size={11} className="pointer-events-none absolute left-2 top-2 text-[hsl(var(--wb-text-muted))]" />
                <input
                  className={cn(inputClass, "w-full pl-7")}
                  value={relationFilter}
                  onChange={(event) => setRelationFilter(event.target.value)}
                  placeholder="Filter relations"
                  aria-label="Filter draft relations"
                />
              </div>
              <div className="mt-2 flex gap-1">
                <input
                  className={cn(inputClass, "flex-1")}
                  value={newRelationName}
                  onChange={(event) => setNewRelationName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && createRelation()}
                  placeholder="new_table"
                  aria-label="New draft relation name"
                />
                <button
                  type="button"
                  className="wb-icon-button h-7 w-7"
                  disabled={!newRelationName.trim()}
                  onClick={createRelation}
                  title="Add relation"
                >
                  <Plus size={11} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {visibleRelations.map((relation) => (
                <button
                  key={relation.name}
                  type="button"
                  className={cn(
                    "mb-0.5 flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left font-mono text-[9px]",
                    selectedName === relation.name
                      ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                      : "wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                  )}
                  onClick={() => setSelectedName(relation.name)}
                >
                  <Table2 size={10} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{relation.name}</span>
                  <span className="text-[8px] opacity-70">{relation.columns.length}</span>
                </button>
              ))}
              {hiddenRelationCount > 0 && (
                <div className="px-2 py-2 text-[8px] leading-4 wb-muted">
                  {hiddenRelationCount.toLocaleString()} more relations hidden. Refine the filter.
                </div>
              )}
            </div>
          </aside>

          <main className="min-h-0 overflow-auto bg-[hsl(var(--wb-editor))] p-3">
            {selectedRelation ? (
              <div className="space-y-3">
                <DraftSection title="Relation" detail={selectedRelation.objectType || "BASE TABLE"}>
                  <div className="flex items-center gap-2">
                    <input
                      className={cn(inputClass, "flex-1")}
                      value={relationName}
                      onChange={(event) => setRelationName(event.target.value)}
                      aria-label="Draft relation name"
                    />
                    <button
                      type="button"
                      className="wb-text-button h-7 gap-1.5 px-2.5 text-[9px]"
                      disabled={!relationName.trim() || relationName.trim() === selectedRelation.name}
                      onClick={renameRelation}
                    >
                      <Check size={10} /> Rename
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "wb-text-button h-7 gap-1.5 px-2.5 text-[9px]",
                        pendingRelationDelete && "text-red-300",
                      )}
                      onClick={deleteRelation}
                      title="Removes the relation and inbound draft foreign keys"
                    >
                      <Trash2 size={10} /> {pendingRelationDelete ? "Confirm remove" : "Remove"}
                    </button>
                  </div>
                </DraftSection>

                <DraftSection title={`Columns · ${selectedRelation.columns.length}`} detail="Click a row to edit">
                  <div className="max-h-48 overflow-auto border-b border-[hsl(var(--wb-border-subtle))]">
                    {selectedRelation.columns.map((column) => (
                      <div
                        key={column.name}
                        className={cn(
                          "flex h-7 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] px-2 text-[9px] first:border-t-0",
                          editingColumnName === column.name && "bg-[hsl(var(--wb-active-strong))]",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => editColumn(column)}
                        >
                          <span className="w-5 shrink-0 font-mono text-[8px] text-amber-300">
                            {column.is_primary_key ? "PK" : column.is_unique ? "UQ" : ""}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono">{column.name}</span>
                          <span className="max-w-40 truncate font-mono text-[8px] wb-muted">{column.data_type}</span>
                          <span className="w-12 text-right text-[8px] wb-muted">{column.is_nullable ? "NULL" : "NOT NULL"}</span>
                        </button>
                        <button
                          type="button"
                          className="wb-icon-button h-6 w-6 hover:text-red-300"
                          onClick={() => removeColumn(column.name)}
                          title={`Remove ${column.name} and dependent draft metadata`}
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-[minmax(100px,0.8fr)_minmax(120px,1fr)_auto_auto] gap-2 p-2">
                    <input className={inputClass} value={columnName} onChange={(event) => setColumnName(event.target.value)} placeholder="column_name" aria-label="Draft column name" />
                    <input className={inputClass} value={columnType} onChange={(event) => setColumnType(event.target.value)} placeholder="data type" aria-label="Draft column type" />
                    <label className="flex h-7 items-center gap-1.5 text-[8px] wb-muted"><input type="checkbox" checked={columnNullable} onChange={(event) => setColumnNullable(event.target.checked)} /> Nullable</label>
                    {!editingColumnName && <label className="flex h-7 items-center gap-1.5 text-[8px] wb-muted"><input type="checkbox" checked={columnPrimary} onChange={(event) => setColumnPrimary(event.target.checked)} /> PK</label>}
                    {!editingColumnName && <label className="flex h-7 items-center gap-1.5 text-[8px] wb-muted"><input type="checkbox" checked={columnUnique} onChange={(event) => setColumnUnique(event.target.checked)} /> Unique</label>}
                    <input className={inputClass} value={columnDefault} onChange={(event) => setColumnDefault(event.target.value)} placeholder="default (optional)" aria-label="Draft column default" />
                    <input className={cn(inputClass, "col-span-2")} value={columnComment} onChange={(event) => setColumnComment(event.target.value)} placeholder="comment (optional)" aria-label="Draft column comment" />
                    <div className="col-span-full flex justify-end gap-1.5">
                      {editingColumnName && <button type="button" className="wb-text-button h-7 px-2.5 text-[9px]" onClick={resetColumnForm}>Cancel edit</button>}
                      <button type="button" className="wb-text-button h-7 gap-1.5 px-2.5 text-[9px]" disabled={!columnName.trim() || !columnType.trim()} onClick={saveColumn}>
                        {editingColumnName ? <Check size={10} /> : <Plus size={10} />} {editingColumnName ? "Save column" : "Add column"}
                      </button>
                    </div>
                  </div>
                </DraftSection>

                <div className="grid grid-cols-2 gap-3">
                  <DraftSection title={`Indexes · ${selectedRelation.indexes.length}`} detail="Comma-separated columns">
                    <MetadataRows
                      values={selectedRelation.indexes.map((index) => ({
                        key: index.name,
                        label: index.name,
                        detail: `${index.columns.join(", ")}${index.is_unique ? " · UNIQUE" : ""}`,
                      }))}
                      onRemove={removeIndex}
                    />
                    <div className="grid grid-cols-2 gap-2 p-2">
                      <input className={inputClass} value={indexName} onChange={(event) => setIndexName(event.target.value)} placeholder="index_name" aria-label="Draft index name" />
                      <input className={inputClass} value={indexColumns} onChange={(event) => setIndexColumns(event.target.value)} placeholder="col_a, col_b" aria-label="Draft index columns" />
                      <label className="flex h-7 items-center gap-1.5 text-[8px] wb-muted"><input type="checkbox" checked={indexUnique} onChange={(event) => setIndexUnique(event.target.checked)} /> Unique</label>
                      <button type="button" className="wb-text-button h-7 gap-1.5 px-2 text-[9px]" disabled={!indexName.trim() || !indexColumns.trim()} onClick={addIndex}><Plus size={10} /> Add index</button>
                    </div>
                  </DraftSection>

                  <DraftSection title="Foreign keys" detail="Source and target counts must match">
                    <MetadataRows
                      values={selectedRelation.constraints
                        .filter((constraint) => constraint.constraint_type === "FOREIGN KEY")
                        .map((constraint) => ({
                          key: constraint.name,
                          label: constraint.name,
                          detail: `${constraint.columns.join(", ")} → ${constraint.referenced_table}.${constraint.referenced_columns.join(", ")}`,
                        }))}
                      onRemove={removeConstraint}
                    />
                    <div className="grid grid-cols-2 gap-2 p-2">
                      <input className={inputClass} value={foreignKeyName} onChange={(event) => setForeignKeyName(event.target.value)} placeholder="foreign_key_name" aria-label="Draft foreign key name" />
                      <input className={inputClass} value={foreignKeyColumns} onChange={(event) => setForeignKeyColumns(event.target.value)} placeholder="source columns" aria-label="Draft foreign key source columns" />
                      <select className={inputClass} value={foreignKeyTarget} onChange={(event) => setForeignKeyTarget(event.target.value)} aria-label="Draft foreign key target relation">
                        <option value="">Target relation</option>
                        {draftRelations.map((relation) => <option key={relation.name} value={relation.name}>{relation.name}</option>)}
                      </select>
                      <input className={inputClass} value={foreignKeyTargetColumns} onChange={(event) => setForeignKeyTargetColumns(event.target.value)} placeholder="target columns" aria-label="Draft foreign key target columns" />
                      <button type="button" className="wb-text-button col-span-2 h-7 gap-1.5 px-2 text-[9px]" disabled={!foreignKeyName.trim() || !foreignKeyColumns.trim() || !foreignKeyTarget || !foreignKeyTargetColumns.trim()} onClick={addForeignKey}><KeyRound size={10} /> Add foreign key</button>
                    </div>
                  </DraftSection>
                </div>

                <DraftSection title="CHECK constraints" detail="Stored as review-only definitions">
                  <MetadataRows
                    values={selectedRelation.constraints
                      .filter((constraint) => constraint.constraint_type === "CHECK")
                      .map((constraint) => ({ key: constraint.name, label: constraint.name, detail: constraint.definition || "CHECK" }))}
                    onRemove={removeConstraint}
                  />
                  <div className="grid grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)_auto] gap-2 p-2">
                    <input className={inputClass} value={checkName} onChange={(event) => setCheckName(event.target.value)} placeholder="constraint_name" aria-label="Draft check constraint name" />
                    <input className={inputClass} value={checkDefinition} onChange={(event) => setCheckDefinition(event.target.value)} placeholder="CHECK (amount >= 0)" aria-label="Draft check definition" />
                    <button type="button" className="wb-text-button h-7 gap-1.5 px-2 text-[9px]" disabled={!checkName.trim() || !checkDefinition.trim()} onClick={addCheck}><Plus size={10} /> Add check</button>
                  </div>
                </DraftSection>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-[9px] wb-muted">
                Add or select a relation to begin a structured draft.
              </div>
            )}
          </main>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <div className="min-w-0">
            {error ? (
              <span className="flex items-center gap-1.5 truncate text-[9px] text-red-300" role="alert"><AlertCircle size={11} /> {error}</span>
            ) : (
              <div className="flex min-w-0 items-center gap-2 text-[9px] wb-muted">
                <span className="shrink-0">
                  {draftPersistenceLabel(persistenceState, lastSavedAt)}
                </span>
                <span className="truncate" title={persistenceNotice || undefined}>
                  {persistenceNotice || (dirty
                    ? `${canvasHistory.past.length} reversible canvas/draft action${canvasHistory.past.length === 1 ? "" : "s"}; no SQL will run.`
                    : "No draft changes yet.")}
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(
                "wb-text-button h-7 px-3 text-[10px]",
                pendingDiscard && "text-red-300",
              )}
              disabled={!persistenceReady || isReviewing || persistenceState === "saving"}
              onClick={() => void discardDraft()}
            >
              {pendingDiscard ? "Confirm discard" : "Discard draft"}
            </button>
            <button
              type="button"
              className="wb-text-button h-7 px-3 text-[10px]"
              disabled={!persistenceReady || isReviewing || persistenceState === "saving"}
              onClick={() => void closeWithPersist()}
            >
              Save & close
            </button>
            <button type="button" className="wb-primary-button h-7 min-w-32 justify-center gap-1.5 px-3 text-[10px]" disabled={!persistenceReady || !dirty || isReviewing || persistenceState === "saving"} onClick={() => void reviewDiff()}>
              {isReviewing ? <Loader2 size={11} className="animate-spin" /> : <GitCompareArrows size={11} />}
              Review migration diff
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function DraftSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.34)]">
      <header className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-2.5">
        <span className="text-[9px] font-medium">{title}</span>
        <span className="text-[8px] wb-muted">{detail}</span>
      </header>
      {children}
    </section>
  );
}

function MetadataRows({
  values,
  onRemove,
}: {
  values: Array<{ key: string; label: string; detail: string }>;
  onRemove: (name: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="max-h-28 overflow-auto border-b border-[hsl(var(--wb-border-subtle))]">
      {values.map((value) => (
        <div key={value.key} className="flex h-7 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] px-2 text-[8px] first:border-t-0">
          <span className="min-w-0 flex-1 truncate font-mono" title={value.detail}>{value.label}</span>
          <span className="max-w-48 truncate wb-muted" title={value.detail}>{value.detail}</span>
          <button type="button" className="wb-icon-button h-6 w-6 hover:text-red-300" onClick={() => onRemove(value.key)} title={`Remove ${value.label}`}><X size={10} /></button>
        </div>
      ))}
    </div>
  );
}


function draftPersistenceLabel(
  state: DraftPersistenceState,
  lastSavedAt: number | null,
) {
  if (state === "loading") return "Loading project draft…";
  if (state === "pending") return "Autosave queued";
  if (state === "saving") return "Saving project draft…";
  if (state === "stale") return "Older draft available";
  if (state === "error") return "Project draft unavailable";
  if (state === "saved" && lastSavedAt) {
    return `Saved ${new Date(lastSavedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }
  return "Project draft ready";
}
