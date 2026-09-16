import {
  resolveMetadataConnectionScope,
  type ResolvedMetadataConnectionScope,
} from "@/services/metadataConnectionScope";
import { TABLE_METADATA_CACHE_VERSION, type TableMetadataIdentity } from "./contracts";

const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";

export type ResolvedTableMetadataIdentity = TableMetadataIdentity & {
  projectId: string;
} & ResolvedMetadataConnectionScope;

function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

export function resolveTableMetadataIdentity<T extends TableMetadataIdentity>(
  identity: T,
): T & ResolvedTableMetadataIdentity {
  return {
    ...resolveMetadataConnectionScope(identity),
    projectId: identity.projectId || activeProjectId(),
    databaseName: identity.databaseName || undefined,
  };
}

function tableCacheKey(identity: ResolvedTableMetadataIdentity) {
  return `oxide:table-metadata:v${TABLE_METADATA_CACHE_VERSION}:${encodeURIComponent(
    JSON.stringify([
      identity.projectId,
      identity.connectionId,
      identity.driver,
      identity.driverPackageVersion,
      identity.connectionDatabaseName,
      identity.databaseName,
      identity.schema,
      identity.table,
    ]),
  )}`;
}

export function scopedTableCacheKey(identity: ResolvedTableMetadataIdentity) {
  return `${encodeURIComponent(identity.projectId)}:${tableCacheKey(identity)}`;
}

export function tableMetadataParentId(identity: TableMetadataIdentity) {
  return tableCacheKey(resolveTableMetadataIdentity(identity));
}

export function remoteMetadataScope(identity: ResolvedTableMetadataIdentity) {
  return JSON.stringify([
    identity.projectId,
    identity.connectionId,
    identity.driver,
    identity.driverPackageVersion,
    identity.connectionDatabaseName,
    identity.databaseName || null,
  ]);
}

export function metadataLoadKey(
  options: LoadTableMetadataIdentityOptions,
  generation: number,
) {
  const identity = resolveTableMetadataIdentity(options);
  return `${scopedTableCacheKey(identity)}:indexes:${
    options.includeIndexes !== false
  }:constraints:${options.includeConstraints !== false}:generation:${generation}`;
}

type LoadTableMetadataIdentityOptions = TableMetadataIdentity & {
  includeIndexes?: boolean;
  includeConstraints?: boolean;
};

export function objectSourceLoadKey(
  identity: ResolvedTableMetadataIdentity,
  kind: "ddl" | "view-definition",
  objectType?: string | null,
) {
  return `${scopedTableCacheKey(identity)}:${kind}:${encodeURIComponent(
    objectType || "",
  )}`;
}
