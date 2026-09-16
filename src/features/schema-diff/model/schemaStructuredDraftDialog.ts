import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import type { SchemaSnapshot } from "@/services/tauri/types";

export type SchemaStructuredDraftDialogProps = {
  open: boolean;
  snapshot: SchemaSnapshot;
  initialRelationName?: string | null;
  initialForeignKey?: SchemaStructuredDraftForeignKeySeed | null;
  canvasHistory: SchemaDiagramCanvasHistory;
  onCanvasHistoryChange: (history: SchemaDiagramCanvasHistory) => void;
  onClose: () => void;
};

export type SchemaStructuredDraftForeignKeySeed = {
  sourceRelation: string;
  sourceColumn: string;
  targetRelation: string;
  targetColumn: string;
};

export type DraftPersistenceState =
  | "loading"
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "stale"
  | "error";
