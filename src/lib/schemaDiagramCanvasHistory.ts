import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";

export type SchemaDiagramCanvasState = {
  areas: SchemaDiagramArea[];
  notes: SchemaDiagramNote[];
};

export type SchemaDiagramCanvasHistory = {
  past: SchemaDiagramCanvasState[];
  present: SchemaDiagramCanvasState;
  future: SchemaDiagramCanvasState[];
};

const MAX_CANVAS_HISTORY = 100;

export function createSchemaDiagramCanvasHistory(
  areas: SchemaDiagramArea[] = [],
  notes: SchemaDiagramNote[] = [],
): SchemaDiagramCanvasHistory {
  return {
    past: [],
    present: { areas, notes },
    future: [],
  };
}

export function commitSchemaDiagramCanvas(
  history: SchemaDiagramCanvasHistory,
  next: Partial<SchemaDiagramCanvasState>,
): SchemaDiagramCanvasHistory {
  const present = {
    areas: next.areas ?? history.present.areas,
    notes: next.notes ?? history.present.notes,
  };
  if (schemaDiagramCanvasStatesEqual(history.present, present)) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_CANVAS_HISTORY),
    present,
    future: [],
  };
}

export function undoSchemaDiagramCanvas(
  history: SchemaDiagramCanvasHistory,
): SchemaDiagramCanvasHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, MAX_CANVAS_HISTORY),
  };
}

export function redoSchemaDiagramCanvas(
  history: SchemaDiagramCanvasHistory,
): SchemaDiagramCanvasHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_CANVAS_HISTORY),
    present: next,
    future: history.future.slice(1),
  };
}

function schemaDiagramCanvasStatesEqual(
  left: SchemaDiagramCanvasState,
  right: SchemaDiagramCanvasState,
) {
  return areasEqual(left.areas, right.areas) && notesEqual(left.notes, right.notes);
}

function areasEqual(left: SchemaDiagramArea[], right: SchemaDiagramArea[]) {
  return left === right ||
    (left.length === right.length && left.every((area, index) => {
      const candidate = right[index];
      return area === candidate || Boolean(candidate &&
        (area.id === candidate.id &&
          area.name === candidate.name &&
          area.relationNames.length === candidate.relationNames.length &&
          area.relationNames.every((name, relationIndex) =>
            name === candidate.relationNames[relationIndex]
          )));
    }));
}

function notesEqual(left: SchemaDiagramNote[], right: SchemaDiagramNote[]) {
  return left === right ||
    (left.length === right.length && left.every((note, index) => {
      const candidate = right[index];
      return note === candidate || Boolean(candidate &&
        (note.id === candidate.id &&
          note.content === candidate.content &&
          note.x === candidate.x &&
          note.y === candidate.y &&
          note.width === candidate.width &&
          note.height === candidate.height &&
          note.color === candidate.color));
    }));
}
