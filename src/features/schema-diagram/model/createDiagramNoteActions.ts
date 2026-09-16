import { NEW_NOTE_ID } from "@/features/schema-diagram/model/diagramConstants";
import { createDiagramNoteId } from "@/features/schema-diagram/model/diagramPresentation";
import type { TabData } from "@/features/workspace-tabs/model/types";
import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import { commitSchemaDiagramCanvas } from "@/lib/schemaDiagramCanvasHistory";
import type {
  SchemaDiagramNote,
  SchemaDiagramNoteColor,
} from "@/services/schemaDiagramCanvasStore";

interface CreateDiagramNoteActionsContext {
  setSchemaDiagramCanvasHistory: (
    tabId: string,
    history: SchemaDiagramCanvasHistory,
  ) => void;
  activeTab: Pick<TabData, "id">;
  canvasHistory: SchemaDiagramCanvasHistory;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  setNoteContentDraft: React.Dispatch<React.SetStateAction<string>>;
  setNoteColorDraft: React.Dispatch<
    React.SetStateAction<SchemaDiagramNoteColor>
  >;
  setNotePositionDraft: React.Dispatch<
    React.SetStateAction<{ x: number; y: number }>
  >;
  setPendingNoteDelete: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingNoteId: React.Dispatch<React.SetStateAction<string | null>>;
  noteContentDraft: string;
  editingNoteId: string | null;
  diagramNotes: SchemaDiagramNote[];
  notePositionDraft: { x: number; y: number };
  noteColorDraft: SchemaDiagramNoteColor;
  pendingNoteDelete: boolean;
}

export function createDiagramNoteActions({
  setSchemaDiagramCanvasHistory,
  activeTab,
  canvasHistory,
  viewportRef,
  zoom,
  setNoteContentDraft,
  setNoteColorDraft,
  setNotePositionDraft,
  setPendingNoteDelete,
  setEditingNoteId,
  noteContentDraft,
  editingNoteId,
  diagramNotes,
  notePositionDraft,
  noteColorDraft,
  pendingNoteDelete,
}: CreateDiagramNoteActionsContext) {
  const commitNotes = (nextNotes: SchemaDiagramNote[]) => {
    setSchemaDiagramCanvasHistory(
      activeTab.id,
      commitSchemaDiagramCanvas(canvasHistory, { notes: nextNotes }),
    );
  };

  const beginCreateNote = () => {
    const viewport = viewportRef.current;
    const x = viewport
      ? Math.max(
          0,
          (viewport.scrollLeft + viewport.clientWidth / 2) / zoom - 110,
        )
      : 24;
    const y = viewport
      ? Math.max(
          0,
          (viewport.scrollTop + viewport.clientHeight / 2) / zoom - 60,
        )
      : 24;
    setNoteContentDraft("");
    setNoteColorDraft("amber");
    setNotePositionDraft({ x, y });
    setPendingNoteDelete(false);
    setEditingNoteId(NEW_NOTE_ID);
  };

  const beginEditNote = (note: SchemaDiagramNote) => {
    setNoteContentDraft(note.content);
    setNoteColorDraft(note.color);
    setNotePositionDraft({ x: note.x, y: note.y });
    setPendingNoteDelete(false);
    setEditingNoteId(note.id);
  };

  const saveNote = () => {
    const content = noteContentDraft.trim();
    if (!editingNoteId || !content) return;
    if (editingNoteId === NEW_NOTE_ID) {
      commitNotes([
        ...diagramNotes,
        {
          id: createDiagramNoteId(),
          content,
          x: notePositionDraft.x,
          y: notePositionDraft.y,
          width: 220,
          height: 120,
          color: noteColorDraft,
        },
      ]);
    } else {
      commitNotes(
        diagramNotes.map((note) =>
          note.id === editingNoteId
            ? { ...note, content, color: noteColorDraft }
            : note,
        ),
      );
    }
    setEditingNoteId(null);
    setPendingNoteDelete(false);
  };

  const removeEditingNote = () => {
    if (!editingNoteId || editingNoteId === NEW_NOTE_ID) return;
    if (!pendingNoteDelete) {
      setPendingNoteDelete(true);
      return;
    }
    commitNotes(diagramNotes.filter((note) => note.id !== editingNoteId));
    setEditingNoteId(null);
    setPendingNoteDelete(false);
  };

  const moveNote = (noteId: string, x: number, y: number) => {
    commitNotes(
      diagramNotes.map((note) =>
        note.id === noteId
          ? { ...note, x: Math.max(0, x), y: Math.max(0, y) }
          : note,
      ),
    );
  };

  const resizeNote = (noteId: string, width: number, height: number) => {
    commitNotes(
      diagramNotes.map((note) =>
        note.id === noteId ? { ...note, width, height } : note,
      ),
    );
  };

  return {
    beginCreateNote,
    beginEditNote,
    saveNote,
    removeEditingNote,
    moveNote,
    resizeNote,
  };
}
