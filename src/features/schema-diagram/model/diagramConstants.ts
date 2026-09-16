import { createSchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";

export const MIN_ZOOM = 0.35;

export const MAX_ZOOM = 1.6;

export const VIEWPORT_OVERSCAN = 320;

export const VIEWPORT_BUCKET = 160;

export const NEW_NOTE_ID = "__new_diagram_note__";

export const EMPTY_CANVAS_HISTORY = createSchemaDiagramCanvasHistory();

export type DiagramViewportWindow = {
  x: number;
  y: number;
  width: number;
  height: number;
};
