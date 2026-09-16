import type { DatabaseDriver } from "@/services/tauri/types";
import type { ResolvedMetadataConnectionScope } from "@/services/metadataConnectionScope";
import type { Resource } from "@/services/tauri/store.service";

export const POSTGRES_DATABASE_CATALOG_CACHE_KIND =
  "POSTGRES_DATABASE_CATALOG_CACHE";
export const POSTGRES_DATABASE_CATALOG_CACHE_VERSION = 2;

export interface PostgresDatabaseCatalogIdentity {
  projectId: string;
  connectionId: string;
  /**
   * The historical storage name is retained for compatibility, while the key
   * remains driver scoped for every capability-declared catalog provider.
   */
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
}

export type ResolvedPostgresDatabaseCatalogIdentity =
  PostgresDatabaseCatalogIdentity & ResolvedMetadataConnectionScope;

export interface PostgresDatabaseCatalogSnapshot {
  databases: string[];
  source: "cache" | "remote";
  updatedAt: number;
}

export interface StoredPostgresDatabaseCatalog {
  version: number;
  driver: DatabaseDriver;
  driverPackageVersion: string | null;
  connectionDatabaseName: string | null;
  connectionId: string;
  databases: string[];
}

export type CatalogResource = Resource;
export type PostgresDatabaseCatalogListener = (
  snapshot: PostgresDatabaseCatalogSnapshot,
) => void;
