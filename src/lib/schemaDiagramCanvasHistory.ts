import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import type { SchemaRelationSnapshot } from "@/services/tauri/types";

export type SchemaDiagramCanvasDraft = {
  baseFingerprint: string;
  relations: SchemaRelationSnapshot[];
};

export type SchemaDiagramCanvasState = {
  areas: SchemaDiagramArea[];
  notes: SchemaDiagramNote[];
  draft?: SchemaDiagramCanvasDraft;
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
  draft?: SchemaDiagramCanvasDraft,
): SchemaDiagramCanvasHistory {
  return {
    past: [],
    present: { areas, notes, draft },
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
    draft: next.draft ?? history.present.draft,
  };
  if (schemaDiagramCanvasStatesEqual(history.present, present)) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_CANVAS_HISTORY),
    present,
    future: [],
  };
}

export function commitSchemaDiagramDraftToCanvas(
  history: SchemaDiagramCanvasHistory,
  baseFingerprint: string,
  relations: SchemaRelationSnapshot[],
  baseRelations: SchemaRelationSnapshot[],
): SchemaDiagramCanvasHistory {
  const draft = relations === baseRelations
    ? undefined
    : { baseFingerprint, relations };
  return commitCanvasState(history, { ...history.present, draft });
}

export function hydrateSchemaDiagramCanvasDraft(
  history: SchemaDiagramCanvasHistory,
  draft: SchemaDiagramCanvasDraft | undefined,
): SchemaDiagramCanvasHistory {
  const hydrate = (state: SchemaDiagramCanvasState): SchemaDiagramCanvasState =>
    state.draft === draft ? state : { ...state, draft };
  return {
    past: history.past.map(hydrate),
    present: hydrate(history.present),
    future: history.future.map(hydrate),
  };
}

export function rebaseSchemaDiagramCanvasDraft(
  history: SchemaDiagramCanvasHistory,
  baseFingerprint: string,
): SchemaDiagramCanvasHistory {
  const normalize = (state: SchemaDiagramCanvasState): SchemaDiagramCanvasState =>
    state.draft && state.draft.baseFingerprint !== baseFingerprint
      ? { ...state, draft: undefined }
      : state;
  const present = normalize(history.present);
  const past: SchemaDiagramCanvasState[] = [];
  for (const state of history.past.map(normalize)) {
    if (!past.length || !schemaDiagramCanvasStatesEqual(past[past.length - 1]!, state)) {
      past.push(state);
    }
  }
  while (past.length && schemaDiagramCanvasStatesEqual(past[past.length - 1]!, present)) {
    past.pop();
  }
  const future: SchemaDiagramCanvasState[] = [];
  let previous = present;
  for (const state of history.future.map(normalize)) {
    if (!schemaDiagramCanvasStatesEqual(previous, state)) {
      future.push(state);
      previous = state;
    }
  }
  return { past, present, future };
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
  return areasEqual(left.areas, right.areas) &&
    notesEqual(left.notes, right.notes) &&
    draftsEqual(left.draft, right.draft);
}

function commitCanvasState(
  history: SchemaDiagramCanvasHistory,
  present: SchemaDiagramCanvasState,
): SchemaDiagramCanvasHistory {
  if (schemaDiagramCanvasStatesEqual(history.present, present)) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_CANVAS_HISTORY),
    present,
    future: [],
  };
}

function draftsEqual(
  left: SchemaDiagramCanvasDraft | undefined,
  right: SchemaDiagramCanvasDraft | undefined,
) {
  return left === right || Boolean(
    left && right &&
      left.baseFingerprint === right.baseFingerprint &&
      left.relations === right.relations,
  );
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
