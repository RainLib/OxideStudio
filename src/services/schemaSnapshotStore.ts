import {
  schemaService,
  storeService,
  type Resource,
  type SchemaDiffPlan,
  type SchemaSnapshot,
} from "@/services/tauri";
import type { DatabaseDriver } from "@/services/tauri/types";

const SCHEMA_SNAPSHOT_KIND = "SCHEMA_SNAPSHOT";
const SCHEMA_SNAPSHOT_VERSION = 1;

export interface SchemaSnapshotIdentity {
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: DatabaseDriver;
  databaseName?: string | null;
  schemaName: string;
  /**
   * Optional UI origin only. A table-initiated migration still captures the
   * containing schema so foreign keys and dependent relations are reviewed.
   * It is intentionally not sent to the snapshot backend or persistence key.
   */
  tableName?: string | null;
}

export function schemaSnapshotParentId(identity: SchemaSnapshotIdentity) {
  return `oxide:schema-snapshots:v1:${encodeURIComponent(
    JSON.stringify([
      identity.projectId,
      identity.connectionId,
      identity.driver,
      identity.databaseName || null,
      identity.schemaName,
    ]),
  )}`;
}

export async function captureLiveSchemaSnapshot(
  identity: SchemaSnapshotIdentity,
  options: { allowPartial?: boolean } = {},
) {
  return schemaService.captureSchemaSnapshot({
    projectId: identity.projectId,
    connectionId: identity.connectionId,
    connectionName: identity.connectionName,
    driver: identity.driver,
    database: identity.databaseName,
    schema: identity.schemaName,
    allowPartial: options.allowPartial,
  });
}

export async function saveSchemaSnapshot(
  snapshot: SchemaSnapshot,
): Promise<void> {
  const identity = identityFromSnapshot(snapshot);
  await storeService.saveResources(
    [
      {
        id: snapshot.id,
        project_id: snapshot.projectId,
        connection_id: snapshot.connectionId,
        parent_id: schemaSnapshotParentId(identity),
        kind: SCHEMA_SNAPSHOT_KIND,
        name: `${snapshot.schemaName} · ${new Date(snapshot.capturedAt).toISOString()}`,
        metadata: snapshot,
        last_updated: snapshot.capturedAt,
      },
    ],
    snapshot.projectId,
  );
}

export async function captureAndSaveSchemaSnapshot(
  identity: SchemaSnapshotIdentity,
) {
  const snapshot = await captureLiveSchemaSnapshot(identity);
  await saveSchemaSnapshot(snapshot);
  return snapshot;
}

export async function listSchemaSnapshots(
  identity: SchemaSnapshotIdentity,
): Promise<SchemaSnapshot[]> {
  const resources = await storeService.getResources(
    identity.connectionId,
    schemaSnapshotParentId(identity),
    identity.projectId,
  );
  return resources
    .filter((resource) => resource.kind === SCHEMA_SNAPSHOT_KIND)
    .map(parseSnapshotResource)
    .filter((snapshot): snapshot is SchemaSnapshot => snapshot !== null)
    .sort((left, right) => right.capturedAt - left.capturedAt);
}

export async function deleteSchemaSnapshot(snapshot: SchemaSnapshot) {
  const identity = identityFromSnapshot(snapshot);
  const remaining = (await listSchemaSnapshots(identity)).filter(
    (candidate) => candidate.id !== snapshot.id,
  );
  await storeService.replaceResources(
    snapshot.connectionId,
    schemaSnapshotParentId(identity),
    SCHEMA_SNAPSHOT_KIND,
    remaining.map(snapshotResource),
    snapshot.projectId,
  );
}

export async function compareSnapshotToLive(
  source: SchemaSnapshot,
  targetIdentity: SchemaSnapshotIdentity,
): Promise<{ target: SchemaSnapshot; plan: SchemaDiffPlan }> {
  const target = await captureLiveSchemaSnapshot(targetIdentity);
  const plan = await schemaService.compareSchemaSnapshots(source, target);
  return { target, plan };
}

function parseSnapshotResource(resource: Resource): SchemaSnapshot | null {
  const snapshot = resource.metadata as Partial<SchemaSnapshot> | null;
  if (
    !snapshot ||
    snapshot.version !== SCHEMA_SNAPSHOT_VERSION ||
    typeof snapshot.id !== "string" ||
    typeof snapshot.fingerprint !== "string" ||
    typeof snapshot.connectionId !== "string" ||
    typeof snapshot.schemaName !== "string" ||
    !Array.isArray(snapshot.relations)
  ) {
    return null;
  }
  return snapshot as SchemaSnapshot;
}

function identityFromSnapshot(
  snapshot: SchemaSnapshot,
): SchemaSnapshotIdentity {
  return {
    projectId: snapshot.projectId,
    connectionId: snapshot.connectionId,
    connectionName: snapshot.connectionName,
    driver: snapshot.driver,
    databaseName: snapshot.databaseName,
    schemaName: snapshot.schemaName,
  };
}

function snapshotResource(snapshot: SchemaSnapshot): Resource {
  return {
    id: snapshot.id,
    project_id: snapshot.projectId,
    connection_id: snapshot.connectionId,
    parent_id: schemaSnapshotParentId(identityFromSnapshot(snapshot)),
    kind: SCHEMA_SNAPSHOT_KIND,
    name: `${snapshot.schemaName} · ${new Date(snapshot.capturedAt).toISOString()}`,
    metadata: snapshot,
    last_updated: snapshot.capturedAt,
  };
}
