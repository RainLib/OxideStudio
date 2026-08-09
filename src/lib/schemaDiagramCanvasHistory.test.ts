import { describe, expect, it } from "vitest";
import {
  commitSchemaDiagramCanvas,
  createSchemaDiagramCanvasHistory,
  redoSchemaDiagramCanvas,
  undoSchemaDiagramCanvas,
} from "./schemaDiagramCanvasHistory";

const area = { id: "area-1", name: "Core", relationNames: ["users"] };
const note = {
  id: "note-1",
  content: "Review ownership",
  x: 10,
  y: 20,
  width: 220,
  height: 120,
  color: "amber" as const,
};

describe("schema diagram canvas history", () => {
  it("undoes and redoes area and note changes in one timeline", () => {
    const initial = createSchemaDiagramCanvasHistory();
    const withArea = commitSchemaDiagramCanvas(initial, { areas: [area] });
    const withNote = commitSchemaDiagramCanvas(withArea, { notes: [note] });

    expect(withNote.past).toHaveLength(2);
    expect(undoSchemaDiagramCanvas(withNote).present).toEqual({
      areas: [area],
      notes: [],
    });
    expect(redoSchemaDiagramCanvas(undoSchemaDiagramCanvas(withNote)).present)
      .toEqual(withNote.present);
  });

  it("preserves unchanged array references for structural sharing", () => {
    const initial = createSchemaDiagramCanvasHistory([area], [note]);
    const moved = commitSchemaDiagramCanvas(initial, {
      notes: [{ ...note, x: 80 }],
    });

    expect(moved.present.areas).toBe(initial.present.areas);
    expect(moved.past[0]).toBe(initial.present);
    expect(moved.present.notes).not.toBe(initial.present.notes);
  });

  it("skips semantic no-ops and clears redo after a new action", () => {
    const initial = createSchemaDiagramCanvasHistory([area], [note]);
    const noOp = commitSchemaDiagramCanvas(initial, {
      notes: [{ ...note }],
    });
    expect(noOp).toBe(initial);

    const moved = commitSchemaDiagramCanvas(initial, {
      notes: [{ ...note, y: 50 }],
    });
    const undone = undoSchemaDiagramCanvas(moved);
    expect(undone.future).toHaveLength(1);
    expect(commitSchemaDiagramCanvas(undone, { areas: [] }).future).toEqual([]);
  });

  it("keeps only the latest one hundred undo states", () => {
    let history = createSchemaDiagramCanvasHistory([], [note]);
    for (let index = 1; index <= 120; index += 1) {
      history = commitSchemaDiagramCanvas(history, {
        notes: [{ ...note, x: index }],
      });
    }
    expect(history.past).toHaveLength(100);
    expect(history.past[0]!.notes[0]!.x).toBe(20);
  });
});
