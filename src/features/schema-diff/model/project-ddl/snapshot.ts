import { projectDdlDialectForDriver } from "@/features/schema-diff/model/project-ddl/dialect";
import { parseProjectDdl } from "@/features/schema-diff/model/project-ddl/parseProjectDdl";
import { type ProjectDdlSnapshotIdentity } from "@/features/schema-diff/model/project-ddl/types";
import type {
  SchemaObjectSnapshot,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";

export const OFFLINE_DDL_WARNING = "OFFLINE_PROJECT_DDL_REVIEW_ONLY";

export function createProjectDdlSnapshot(
  identity: ProjectDdlSnapshotIdentity,
  relativePath: string | readonly string[],
  sql: string,
  capturedAt = Date.now(),
): SchemaSnapshot {
  const sourcePaths = Array.from(
    new Set(
      (Array.isArray(relativePath) ? relativePath : [relativePath])
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const parsed = parseProjectDdl(
    sql,
    identity.schemaName,
    projectDdlDialectForDriver(identity.driver),
  );
  const fingerprint = stableSnapshotFingerprint(
    identity,
    sourcePaths,
    parsed.relations,
    parsed.schemaObjects,
  );
  return {
    version: 1,
    id: `project-ddl-${capturedAt}-${fingerprint.slice(0, 12)}`,
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
      OFFLINE_DDL_WARNING,
      ...sourcePaths.map((path) => `Source: ${path}`),
      `DDL dialect: ${parsed.dialect}`,
      ...parsed.warnings,
    ],
  };
}

export function isProjectDdlSnapshot(snapshot: SchemaSnapshot) {
  return snapshot.warnings.includes(OFFLINE_DDL_WARNING);
}

export function projectDdlSnapshotSources(snapshot: SchemaSnapshot) {
  return snapshot.warnings
    .filter((warning) => warning.startsWith("Source: "))
    .map((warning) => warning.slice("Source: ".length));
}

export function stableSnapshotFingerprint(
  identity: ProjectDdlSnapshotIdentity,
  paths: readonly string[],
  relations: SchemaRelationSnapshot[],
  schemaObjects: SchemaObjectSnapshot[],
) {
  const payload: unknown[] = [
    identity.driver,
    identity.databaseName || null,
    identity.schemaName,
    paths,
    relations,
  ];
  // Keep existing relation-only baselines stable while making descriptor-only
  // objects authoritative as soon as the source contains one.
  if (schemaObjects.length > 0) payload.push(schemaObjects);
  const input = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `offline-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
