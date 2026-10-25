import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SchemaDbmlDraftDialog } from "@/components/workspace/SchemaDbmlDraftDialog";
import { SchemaDiagramNoteDialog } from "@/components/workspace/SchemaDiagramNoteDialog";
import type { SchemaStructuredDraftForeignKeySeed } from "@/components/workspace/SchemaStructuredDraftDialog";
import { NEW_NOTE_ID } from "@/features/schema-diagram/model/diagramConstants";
import { SchemaStructuredDraftDialog } from "@/features/schema-diagram/ui/DiagramDrafts";
import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import type { SchemaDiagramNoteColor } from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { Suspense } from "react";

interface DiagramDialogsContext {
  renamingAreaId: string | null;
  setRenamingAreaId: React.Dispatch<React.SetStateAction<string | null>>;
  commitAreaRename: () => void;
  areaNameDraft: string;
  setAreaNameDraft: React.Dispatch<React.SetStateAction<string>>;
  areaNameError: string | null;
  editingNoteId: string | null;
  noteContentDraft: string;
  noteColorDraft: SchemaDiagramNoteColor;
  pendingNoteDelete: boolean;
  setNoteContentDraft: React.Dispatch<React.SetStateAction<string>>;
  setNoteColorDraft: React.Dispatch<
    React.SetStateAction<SchemaDiagramNoteColor>
  >;
  removeEditingNote: () => void;
  setEditingNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  setPendingNoteDelete: React.Dispatch<React.SetStateAction<boolean>>;
  saveNote: () => void;
  dbmlDraftOpen: boolean;
  snapshot: SchemaSnapshot;
  setDbmlDraftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  structuredDraftOpen: boolean;
  foreignKeySeed: SchemaStructuredDraftForeignKeySeed | null;
  selectedName: string | null;
  canvasHistory: SchemaDiagramCanvasHistory;
  updateCanvasHistory: (history: SchemaDiagramCanvasHistory) => void;
  setStructuredDraftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setForeignKeySeed: React.Dispatch<
    React.SetStateAction<SchemaStructuredDraftForeignKeySeed | null>
  >;
}

export function DiagramDialogs({
  renamingAreaId,
  setRenamingAreaId,
  commitAreaRename,
  areaNameDraft,
  setAreaNameDraft,
  areaNameError,
  editingNoteId,
  noteContentDraft,
  noteColorDraft,
  pendingNoteDelete,
  setNoteContentDraft,
  setNoteColorDraft,
  removeEditingNote,
  setEditingNoteId,
  setPendingNoteDelete,
  saveNote,
  dbmlDraftOpen,
  snapshot,
  setDbmlDraftOpen,
  structuredDraftOpen,
  foreignKeySeed,
  selectedName,
  canvasHistory,
  updateCanvasHistory,
  setStructuredDraftOpen,
  setForeignKeySeed,
}: DiagramDialogsContext) {
  return (
    <>
      <Dialog
        open={Boolean(renamingAreaId)}
        onOpenChange={(open) => {
          if (!open) setRenamingAreaId(null);
        }}
      >
        <DialogContent layout="custom" className="w-[420px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
            <DialogTitle className="text-[13px] font-semibold">
              Rename area
            </DialogTitle>
            <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
              Area names identify visual groups in this diagram.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitAreaRename();
            }}
          >
            <div className="space-y-1.5 p-4">
              <label
                htmlFor="schema-diagram-area-name"
                className="text-[10px] font-medium text-[hsl(var(--wb-text-muted))]"
              >
                Area name
              </label>
              <Input
                id="schema-diagram-area-name"
                autoFocus
                value={areaNameDraft}
                onChange={(event) => setAreaNameDraft(event.target.value)}
                aria-invalid={Boolean(areaNameError)}
                aria-describedby={
                  areaNameError ? "schema-diagram-area-name-error" : undefined
                }
                className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] text-[11px]"
              />
              {areaNameError && (
                <p
                  id="schema-diagram-area-name-error"
                  className="text-[10px] text-red-300"
                  role="alert"
                >
                  {areaNameError}
                </p>
              )}
            </div>
            <DialogFooter className="flex-row justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.56)] px-4 py-2.5 sm:space-x-0">
              <Button
                type="button"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setRenamingAreaId(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-7 text-[11px]"
                disabled={Boolean(areaNameError)}
              >
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <SchemaDiagramNoteDialog
        open={Boolean(editingNoteId)}
        mode={editingNoteId === NEW_NOTE_ID ? "create" : "edit"}
        content={noteContentDraft}
        color={noteColorDraft}
        pendingDelete={pendingNoteDelete}
        onContentChange={setNoteContentDraft}
        onColorChange={setNoteColorDraft}
        onDelete={removeEditingNote}
        onCancel={() => {
          setEditingNoteId(null);
          setPendingNoteDelete(false);
        }}
        onSave={saveNote}
      />
      <SchemaDbmlDraftDialog
        open={dbmlDraftOpen}
        snapshot={snapshot}
        onClose={() => setDbmlDraftOpen(false)}
      />
      {structuredDraftOpen && (
        <Suspense fallback={null}>
          <SchemaStructuredDraftDialog
            open
            snapshot={snapshot}
            initialRelationName={foreignKeySeed?.sourceRelation || selectedName}
            initialForeignKey={foreignKeySeed}
            canvasHistory={canvasHistory}
            onCanvasHistoryChange={updateCanvasHistory}
            onClose={() => {
              setStructuredDraftOpen(false);
              setForeignKeySeed(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
