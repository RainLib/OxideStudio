import {
  getObjectLoadKey,
  getObjectSnapshotKey,
  readPinnedTables,
} from "@/features/schema-metadata/model/metadataIdentity";

import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import {
  CollectionInfo,
  FunctionInfo,
  schemaService,
  TableInfo,
} from "@/services/tauri";
import type { SchemaSlice } from "./types";

export const createBackgroundSearchSlice: SchemaSlice<
  "loadSchemaObjectsForSearch"
> = (set, get, runtime) => {
  const {
    getConnectionDriver,
    captureMetadataRequest,
    isMetadataRequestCurrent,
    metadataRequestKey,
    schemaSearchLoadsInFlight,
  } = runtime;
  return {
    loadSchemaObjectsForSearch: async (
      connectionId: string,
      schema: string,
    ) => {
      if (!connectionId || !schema) return false;
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return false;
      const driver = getConnectionDriver(connectionId);
      if (!driver) return false;
      const objectKey = getObjectSnapshotKey(connectionId, driver, schema);
      if (
        Object.prototype.hasOwnProperty.call(get().objectSnapshots, objectKey)
      ) {
        return true;
      }
      const requestKey = metadataRequestKey(request, "search", driver, schema);
      const pending = schemaSearchLoadsInFlight.get(requestKey);
      if (pending) return pending;

      const promise = (async () => {
        if (await get().hydrateSchemaObjectsFromCache(connectionId, schema)) {
          return true;
        }
        if (!isMetadataRequestCurrent(request)) return false;
        const capabilities = defaultDatabaseCapabilities(driver);
        // Key/value namespaces can contain millions of keys. They keep using the
        // driver's bounded server-side filter rather than materializing a global
        // search snapshot in the Explorer.
        if (capabilities.dataModel === "keyValue") return false;

        try {
          const settle = async <T>(
            enabled: boolean,
            request: () => Promise<T[]>,
          ) => {
            if (!enabled)
              return { attempted: false, ok: true, values: [] as T[] };
            try {
              return { attempted: true, ok: true, values: await request() };
            } catch {
              return { attempted: true, ok: false, values: [] as T[] };
            }
          };
          const [tablesResult, collectionsResult, functionsResult] =
            await Promise.all([
              settle<TableInfo>(capabilities.supportsTableBrowsing, () =>
                schemaService.getTables(connectionId, schema),
              ),
              settle<CollectionInfo>(
                capabilities.supportsCollectionBrowsing,
                () => schemaService.getCollections(connectionId, schema),
              ),
              settle<FunctionInfo>(capabilities.supportsFunctions, () =>
                schemaService.getFunctions(connectionId, schema),
              ),
            ]);
          if (!isMetadataRequestCurrent(request)) return false;
          const attemptedResults = [
            tablesResult,
            collectionsResult,
            functionsResult,
          ].filter((result) => result.attempted);
          if (
            attemptedResults.length > 0 &&
            attemptedResults.every((result) => !result.ok)
          ) {
            return false;
          }
          set((state) => ({
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables: tablesResult.values,
                collections: collectionsResult.values,
                functions: functionsResult.values,
                pinnedTables: readPinnedTables(connectionId, schema, driver),
                selectedTable: null,
                lastLoadedObjectKey: getObjectLoadKey(
                  connectionId,
                  driver,
                  schema,
                  capabilities.supportsTableBrowsing
                    ? "tables"
                    : capabilities.supportsCollectionBrowsing
                      ? "collections"
                      : "functions",
                ),
              },
            },
            metadataVersion: state.metadataVersion + 1,
          }));
          return true;
        } catch {
          // Search is best effort. Expansion and explicit Refresh retain their
          // normal user-visible error state and retry behavior.
          return false;
        }
      })();
      schemaSearchLoadsInFlight.set(requestKey, promise);
      try {
        return await promise;
      } finally {
        if (schemaSearchLoadsInFlight.get(requestKey) === promise) {
          schemaSearchLoadsInFlight.delete(requestKey);
        }
      }
    },
  };
};
