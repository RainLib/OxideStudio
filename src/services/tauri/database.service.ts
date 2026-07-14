import { invokeWithInterceptors } from "./client";
import type { DatabaseCapabilities, DatabaseDriver } from "./types";
import {
  registerDatabaseCapabilities,
  registerRuntimeDatabaseCatalog,
} from "@/lib/databaseDialect";

const capabilitiesCache = new Map<string, Promise<DatabaseCapabilities>>();
let capabilityListCache: Promise<DatabaseCapabilities[]> | null = null;

function cloneCapabilities(
  capabilities: DatabaseCapabilities,
): DatabaseCapabilities {
  return {
    ...capabilities,
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

export async function getDatabaseCapabilities(
  driver: DatabaseDriver,
): Promise<DatabaseCapabilities> {
  const cacheKey = String(driver);
  let cached = capabilitiesCache.get(cacheKey);
  if (!cached) {
    cached = invokeWithInterceptors<DatabaseCapabilities>(
      "get_database_capabilities",
      { driver },
    ).catch((error) => {
      capabilitiesCache.delete(cacheKey);
      throw error;
    });
    capabilitiesCache.set(cacheKey, cached);
  }

  const capabilities = cloneCapabilities(await cached);
  registerDatabaseCapabilities(capabilities);
  return capabilities;
}

export async function listDatabaseCapabilities(): Promise<
  DatabaseCapabilities[]
> {
  if (!capabilityListCache) {
    capabilityListCache = invokeWithInterceptors<DatabaseCapabilities[]>(
      "list_database_capabilities",
    ).catch((error) => {
      capabilityListCache = null;
      throw error;
    });
  }

  const capabilities = (await capabilityListCache).map(cloneCapabilities);
  if (capabilities.length > 0) {
    registerRuntimeDatabaseCatalog(capabilities);
  }
  return capabilities;
}

export async function createDatabase(
  connectionId: string,
  driver: DatabaseDriver,
  database: string,
  charset?: string,
  collation?: string,
  owner?: string,
): Promise<string> {
  return invokeWithInterceptors<string>("create_database", {
    connectionId,
    driver,
    database,
    charset,
    collation,
    owner,
  });
}

export async function dropDatabase(
  connectionId: string,
  driver: DatabaseDriver,
  database: string,
  cascade = false,
): Promise<string> {
  return invokeWithInterceptors<string>("drop_database", {
    connectionId,
    driver,
    database,
    cascade,
  });
}

export async function renameDatabase(
  connectionId: string,
  driver: DatabaseDriver,
  oldName: string,
  newName: string,
): Promise<string> {
  return invokeWithInterceptors<string>("rename_database", {
    connectionId,
    driver,
    oldName,
    newName,
  });
}

export const databaseService = {
  getDatabaseCapabilities,
  listDatabaseCapabilities,
  createDatabase,
  dropDatabase,
  renameDatabase,
};
