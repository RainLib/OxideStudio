import { storeService, type Resource } from "@/services/tauri";
import type {
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";

const SCHEMA_DIAGRAM_DRAFT_KIND = "SCHEMA_DIAGRAM_DRAFT";
const SCHEMA_DIAGRAM_DRAFT_VERSION = 1;
const MAX_DRAFT_RELATIONS = 10_000;
const MAX_DRAFT_CHILD_OBJECTS = 250_000;

export type PersistedSchemaDiagramDraft = {
  version: typeof SCHEMA_DIAGRAM_DRAFT_VERSION;
  baseSnapshotId: string;
  baseFingerprint: string;
  updatedAt: number;
  relations: SchemaRelationSnapshot[];
};

export function schemaDiagramDraftParentId(snapshot: SchemaSnapshot) {
  return `oxide:schema-diagram-drafts:v1:${encodeURIComponent(JSON.stringify([
    snapshot.projectId,
    snapshot.connectionId,
    snapshot.databaseName || null,
    snapshot.schemaName,
  ]))}`;
}

export function parsePersistedSchemaDiagramDraft(
  value: unknown,
): PersistedSchemaDiagramDraft | null {
  if (!isRecord(value)) return null;
  if (
    value.version !== SCHEMA_DIAGRAM_DRAFT_VERSION ||
    typeof value.baseSnapshotId !== "string" ||
    typeof value.baseFingerprint !== "string" ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    !Array.isArray(value.relations) ||
    value.relations.length > MAX_DRAFT_RELATIONS ||
    !isBoundedRelationList(value.relations)
  ) {
    return null;
  }
  return value as PersistedSchemaDiagramDraft;
}

export async function loadSchemaDiagramDraft(snapshot: SchemaSnapshot) {
  const resources = await storeService.getResources(
    snapshot.connectionId,
    schemaDiagramDraftParentId(snapshot),
    snapshot.projectId,
  );
  return resources
    .filter((resource) => resource.kind === SCHEMA_DIAGRAM_DRAFT_KIND)
    .map((resource) => parsePersistedSchemaDiagramDraft(resource.metadata))
    .filter((draft): draft is PersistedSchemaDiagramDraft => draft !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] || null;
}

export async function saveSchemaDiagramDraft(
  snapshot: SchemaSnapshot,
  relations: SchemaRelationSnapshot[],
  updatedAt = Date.now(),
) {
  if (relations.length > MAX_DRAFT_RELATIONS) {
    throw new Error(
      `Diagram drafts are limited to ${MAX_DRAFT_RELATIONS.toLocaleString()} relations.`,
    );
  }
  if (!isBoundedRelationList(relations)) {
    throw new Error("The diagram draft is invalid or exceeds its metadata limit.");
  }
  const parentId = schemaDiagramDraftParentId(snapshot);
  const metadata: PersistedSchemaDiagramDraft = {
    version: SCHEMA_DIAGRAM_DRAFT_VERSION,
    baseSnapshotId: snapshot.id,
    baseFingerprint: snapshot.fingerprint,
    updatedAt,
    relations,
  };
  const resource: Resource = {
    id: `${parentId}:current`,
    project_id: snapshot.projectId,
    connection_id: snapshot.connectionId,
    parent_id: parentId,
    kind: SCHEMA_DIAGRAM_DRAFT_KIND,
    name: `Diagram draft - ${snapshot.schemaName}`,
    metadata,
    last_updated: updatedAt,
  };
  await storeService.replaceResources(
    snapshot.connectionId,
    parentId,
    SCHEMA_DIAGRAM_DRAFT_KIND,
    [resource],
    snapshot.projectId,
  );
  return metadata;
}

export async function deleteSchemaDiagramDraft(snapshot: SchemaSnapshot) {
  await storeService.replaceResources(
    snapshot.connectionId,
    schemaDiagramDraftParentId(snapshot),
    SCHEMA_DIAGRAM_DRAFT_KIND,
    [],
    snapshot.projectId,
  );
}

function isSchemaRelationSnapshot(
  value: unknown,
): value is SchemaRelationSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    Array.isArray(value.columns) &&
    Array.isArray(value.indexes) &&
    Array.isArray(value.constraints) &&
    value.columns.every(isColumn) &&
    value.indexes.every(isIndex) &&
    value.constraints.every(isConstraint)
  );
}

function isBoundedRelationList(relations: unknown[]) {
  let childObjectCount = 0;
  for (const relation of relations) {
    if (!isSchemaRelationSnapshot(relation)) return false;
    childObjectCount +=
      relation.columns.length + relation.indexes.length + relation.constraints.length;
    if (childObjectCount > MAX_DRAFT_CHILD_OBJECTS) return false;
  }
  return true;
}

function isColumn(value: unknown) {
  return isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.data_type === "string" &&
    typeof value.is_nullable === "boolean" &&
    typeof value.is_primary_key === "boolean";
}

function isIndex(value: unknown) {
  return isRecord(value) &&
    typeof value.name === "string" &&
    isStringArray(value.columns) &&
    typeof value.is_unique === "boolean" &&
    typeof value.is_primary === "boolean";
}

function isConstraint(value: unknown) {
  return isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.constraint_type === "string" &&
    isStringArray(value.columns) &&
    isStringArray(value.referenced_columns);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
