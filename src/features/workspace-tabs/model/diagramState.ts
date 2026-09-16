import type { SchemaDiagramAreaHistory } from "@/lib/schemaDiagramAreas";
import {
  createSchemaDiagramCanvasHistory,
  rebaseSchemaDiagramCanvasDraft,
  type SchemaDiagramCanvasHistory,
  type SchemaDiagramCanvasState,
} from "@/lib/schemaDiagramCanvasHistory";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types";

export function normalizeDiagramAreaHistory(
  history: SchemaDiagramAreaHistory | undefined,
  snapshot: SchemaSnapshot,
): SchemaDiagramAreaHistory {
  const relationNames = new Set(
    snapshot.relations.map((relation) => relation.name),
  );
  const normalize = (areas: SchemaDiagramAreaHistory["present"]) =>
    areas.map((area) => ({
      ...area,
      relationNames: area.relationNames.filter((name) =>
        relationNames.has(name),
      ),
    }));
  return history
    ? {
        past: history.past.map(normalize),
        present: normalize(history.present),
        future: history.future.map(normalize),
      }
    : { past: [], present: [], future: [] };
}

export function normalizeDiagramCanvasHistory(
  history: SchemaDiagramCanvasHistory | undefined,
  legacyAreas: SchemaDiagramAreaHistory | undefined,
  legacyNotes: SchemaDiagramNote[] | undefined,
  snapshot: SchemaSnapshot,
): SchemaDiagramCanvasHistory {
  const relationNames = new Set(
    snapshot.relations.map((relation) => relation.name),
  );
  const normalize = (
    state: SchemaDiagramCanvasState,
  ): SchemaDiagramCanvasState => ({
    areas: state.areas.map((area) => ({
      ...area,
      relationNames: area.relationNames.filter((name) =>
        relationNames.has(name),
      ),
    })),
    notes: state.notes,
    draft: state.draft,
  });
  if (!history) {
    return createSchemaDiagramCanvasHistory(
      normalizeDiagramAreaHistory(legacyAreas, snapshot).present,
      legacyNotes || [],
    );
  }
  return rebaseSchemaDiagramCanvasDraft(
    {
      past: history.past.map(normalize),
      present: normalize(history.present),
      future: history.future.map(normalize),
    },
    snapshot.fingerprint,
  );
}
