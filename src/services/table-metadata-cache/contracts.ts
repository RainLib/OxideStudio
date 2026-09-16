import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseDriver,
  IndexInfo,
} from "@/services/tauri/types";
import type { MetadataTaskPriority } from "@/services/metadataTaskLimiter";

export const TABLE_METADATA_CACHE_KIND = "TABLE_METADATA_CACHE";
export const TABLE_METADATA_CACHE_VERSION = 3;
export const MAX_CACHED_OBJECT_SOURCE_CHARS = 5 * 1024 * 1024;
export const MAX_CACHED_OBJECT_SOURCE_AGE_MS = 24 * 60 * 60 * 1000;

export interface TableMetadataIdentity {
  projectId?: string;
  connectionId: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
  databaseName?: string;
  schema: string;
  table: string;
}

export interface LoadTableMetadataOptions extends TableMetadataIdentity {
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  force?: boolean;
  priority?: MetadataTaskPriority;
}

export interface TableMetadataSnapshot {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  ddl: string | null;
  viewDefinition: string | null;
  source: "cache" | "remote";
  updatedAt: number;
}

export interface StoredTableMetadata {
  version: number;
  projectId?: string;
  driver: DatabaseDriver;
  driverPackageVersion: string | null;
  connectionDatabaseName: string | null;
  databaseName?: string;
  schema: string;
  table: string;
  columns?: ColumnInfo[];
  indexes?: IndexInfo[];
  constraints?: ConstraintInfo[];
  ddl?: string | null;
  ddlObjectType?: string | null;
  ddlCachedAt?: number | null;
  viewDefinition?: string | null;
  viewObjectType?: string | null;
  viewDefinitionCachedAt?: number | null;
}
