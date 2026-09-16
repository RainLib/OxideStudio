import { parseSchemaDbml } from "@/features/schema-diff/model/dbml-import/parseSchemaDbml";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type {
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";

export const OFFLINE_DBML_WARNING = "OFFLINE_DBML_REVIEW_ONLY";

export function createSchemaDbmlSnapshot(
  identity: SchemaSnapshotIdentity,
  sourceName: string,
  dbml: string,
  capturedAt = Date.now(),
): SchemaSnapshot {
  const parsed = parseSchemaDbml(dbml, identity.schemaName);
  const fingerprint = stableFingerprint(
    identity,
    sourceName,
    parsed.relations,
    parsed.schemaObjects,
  );
  return {
    version: 1,
    id: `dbml-${capturedAt}-${fingerprint.slice(-8)}`,
    fingerprint,
    projectId: identity.projectId,
    connectionId: identity.connectionId,
    connectionName: identity.connectionName,
    driver: identity.driver,
    databaseName: identity.databaseName || null,
    schemaName: identity.schemaName,
    capturedAt,
    relations: parsed.relations,
    schemaObjects: parsed.schemaObjects,
    warnings: [
      OFFLINE_DBML_WARNING,
      `Source: ${sourceName.trim() || "Imported DBML"}`,
      ...parsed.warnings,
    ],
  };
}

export function isSchemaDbmlSnapshot(snapshot: SchemaSnapshot) {
  return snapshot.warnings.includes(OFFLINE_DBML_WARNING);
}

export function stableFingerprint(
  identity: SchemaSnapshotIdentity,
  sourceName: string,
  relations: SchemaRelationSnapshot[],
  schemaObjects: SchemaObjectSnapshot[],
) {
  const payload: unknown[] = [
    identity.driver,
    identity.databaseName || null,
    identity.schemaName,
    sourceName,
    relations,
  ];
  if (schemaObjects.length > 0) payload.push(schemaObjects);
  const input = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `offline-dbml-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
