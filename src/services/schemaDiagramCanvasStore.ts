import { storeService, type Resource } from "@/services/tauri";
import type { SchemaSnapshot } from "@/services/tauri/types";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";

const SCHEMA_DIAGRAM_CANVAS_KIND = "SCHEMA_DIAGRAM_CANVAS";
const SCHEMA_DIAGRAM_CANVAS_VERSION = 1;
const MAX_AREAS = 250;
const MAX_AREA_RELATIONS = 10_000;
const MAX_NOTES = 500;
const MAX_NOTE_LENGTH = 4_000;
const MAX_CANVAS_COORDINATE = 1_000_000;

export type SchemaDiagramNoteColor =
  | "amber"
  | "violet"
  | "blue"
  | "green"
  | "slate";

export type SchemaDiagramNote = {
  id: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: SchemaDiagramNoteColor;
};

export type PersistedSchemaDiagramCanvas = {
  version: typeof SCHEMA_DIAGRAM_CANVAS_VERSION;
  baseFingerprint: string;
  updatedAt: number;
  areas: SchemaDiagramArea[];
  notes: SchemaDiagramNote[];
};

export function schemaDiagramCanvasParentId(snapshot: SchemaSnapshot) {
  return `oxide:schema-diagram-canvas:v1:${encodeURIComponent(JSON.stringify([
    snapshot.projectId,
    snapshot.connectionId,
    snapshot.databaseName || null,
    snapshot.schemaName,
  ]))}`;
}

export function parsePersistedSchemaDiagramCanvas(
  value: unknown,
): PersistedSchemaDiagramCanvas | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== SCHEMA_DIAGRAM_CANVAS_VERSION ||
    typeof value.baseFingerprint !== "string" ||
    !finiteNumber(value.updatedAt) ||
    !Array.isArray(value.areas) ||
    value.areas.length > MAX_AREAS ||
    !Array.isArray(value.notes) ||
    value.notes.length > MAX_NOTES
  ) {
    return null;
  }
  const areas = value.areas.filter(isSchemaDiagramArea);
  const notes = value.notes.filter(isSchemaDiagramNote);
  const relationCount = areas.reduce(
    (count, area) => count + area.relationNames.length,
    0,
  );
  if (
    areas.length !== value.areas.length ||
    notes.length !== value.notes.length ||
    relationCount > MAX_AREA_RELATIONS ||
    new Set(areas.map((area) => area.id)).size !== areas.length ||
    new Set(notes.map((note) => note.id)).size !== notes.length
  ) {
    return null;
  }
  return {
    version: SCHEMA_DIAGRAM_CANVAS_VERSION,
    baseFingerprint: value.baseFingerprint,
    updatedAt: value.updatedAt,
    areas,
    notes,
  };
}

export function normalizeSchemaDiagramCanvas(
  canvas: PersistedSchemaDiagramCanvas,
  snapshot: SchemaSnapshot,
) {
  const relationNames = new Set(
    snapshot.relations.map((relation) => relation.name),
  );
  return {
    ...canvas,
    areas: canvas.areas.map((area) => ({
      ...area,
      relationNames: area.relationNames.filter((name) => relationNames.has(name)),
    })),
  };
}

export async function loadSchemaDiagramCanvas(snapshot: SchemaSnapshot) {
  const resources = await storeService.getResources(
    snapshot.connectionId,
    schemaDiagramCanvasParentId(snapshot),
    snapshot.projectId,
  );
  const canvas = resources
    .filter((resource) => resource.kind === SCHEMA_DIAGRAM_CANVAS_KIND)
    .map((resource) => parsePersistedSchemaDiagramCanvas(resource.metadata))
    .filter((value): value is PersistedSchemaDiagramCanvas => value !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
  return canvas ? normalizeSchemaDiagramCanvas(canvas, snapshot) : null;
}

export async function saveSchemaDiagramCanvas(
  snapshot: SchemaSnapshot,
  areas: SchemaDiagramArea[],
  notes: SchemaDiagramNote[],
  updatedAt = Date.now(),
) {
  const metadata = parsePersistedSchemaDiagramCanvas({
    version: SCHEMA_DIAGRAM_CANVAS_VERSION,
    baseFingerprint: snapshot.fingerprint,
    updatedAt,
    areas,
    notes,
  });
  if (!metadata) {
    throw new Error("The diagram canvas exceeds its storage limits or is invalid.");
  }
  const parentId = schemaDiagramCanvasParentId(snapshot);
  const resource: Resource = {
    id: `${parentId}:current`,
    project_id: snapshot.projectId,
    connection_id: snapshot.connectionId,
    parent_id: parentId,
    kind: SCHEMA_DIAGRAM_CANVAS_KIND,
    name: `Diagram canvas - ${snapshot.schemaName}`,
    metadata,
    last_updated: updatedAt,
  };
  await storeService.replaceResources(
    snapshot.connectionId,
    parentId,
    SCHEMA_DIAGRAM_CANVAS_KIND,
    [resource],
    snapshot.projectId,
  );
  return metadata;
}

function isSchemaDiagramArea(value: unknown): value is SchemaDiagramArea {
  return isRecord(value) &&
    validId(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    Array.isArray(value.relationNames) &&
    value.relationNames.every(validId) &&
    new Set(value.relationNames).size === value.relationNames.length;
}

function isSchemaDiagramNote(value: unknown): value is SchemaDiagramNote {
  return isRecord(value) &&
    validId(value.id) &&
    typeof value.content === "string" &&
    value.content.length <= MAX_NOTE_LENGTH &&
    boundedCoordinate(value.x) &&
    boundedCoordinate(value.y) &&
    finiteNumber(value.width) &&
    value.width >= 160 && value.width <= 640 &&
    finiteNumber(value.height) &&
    value.height >= 90 && value.height <= 640 &&
    isNoteColor(value.color);
}

function isNoteColor(value: unknown): value is SchemaDiagramNoteColor {
  return value === "amber" || value === "violet" || value === "blue" ||
    value === "green" || value === "slate";
}

function boundedCoordinate(value: unknown) {
  return finiteNumber(value) && Math.abs(value) <= MAX_CANVAS_COORDINATE;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 512 && !value.includes("\u0000");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
