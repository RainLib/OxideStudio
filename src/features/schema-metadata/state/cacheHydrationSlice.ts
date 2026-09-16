import {
  COLLECTION_CACHE_KIND,
  FUNCTION_CACHE_KIND,
  hasCacheMarker,
  redisTotalFromResources,
  resourceMatchesDriver,
  resourcesToCollections,
  resourcesToFunctions,
  resourcesToTables,
  SCHEMA_CACHE_KIND,
  TABLE_CACHE_KIND,
} from "@/features/schema-metadata/model/metadataCache";
import {
  getConnectionMetadataNodeKey,
  getConnectionSnapshotKey,
  getLoadKey,
  getObjectLoadKey,
  getObjectSnapshotKey,
  getSavedDefaultSchema,
  getSchemaMetadataNodeKey,
  getSchemaResourceId,
  readPinnedTables,
} from "@/features/schema-metadata/model/metadataIdentity";

import {
  connectionDatabaseNamespacePreference,
  selectPreferredNamespace,
} from "@/lib/databaseDialect";
import { storeService } from "@/services/tauri";

import type { SchemaSlice } from "./types";

export const createCacheHydrationSlice: SchemaSlice<
  "hydrateConnectionMetadataFromCache" | "hydrateSchemaObjectsFromCache"
> = (set, get, runtime) => {
  const {
    getConnectionDriver,
    captureMetadataRequest,
    isMetadataRequestCurrent,
  } = runtime;
  return {
    hydrateConnectionMetadataFromCache: async (connectionId: string) => {
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return false;
      const connections = runtime.getConnectionState().connections;
      const connection = connections.find((item) => item.id === connectionId);
      const activeDriver = connection?.driver || null;
      const configDefault = connectionDatabaseNamespacePreference(
        activeDriver,
        connection?.database,
      );
      const savedDefault = getSavedDefaultSchema(connectionId, activeDriver);

      try {
        const cachedResources = await storeService.getResources(
          connectionId,
          undefined,
          request.projectId,
        );
        if (!isMetadataRequestCurrent(request)) return false;
        const cachedSchemas = cachedResources
          .filter(
            (resource) =>
              resource.kind === "DATABASE" &&
              resourceMatchesDriver(resource, activeDriver),
          )
          .map((resource) => resource.name);
        const hasCachedSchemaGroup = hasCacheMarker(
          cachedResources,
          SCHEMA_CACHE_KIND,
          activeDriver,
        );

        if (cachedSchemas.length === 0 && !hasCachedSchemaGroup) {
          return false;
        }

        const schemaToSelect = selectPreferredNamespace(
          activeDriver,
          cachedSchemas,
          [configDefault, savedDefault],
        );
        const cachedRedisTotal = redisTotalFromResources(
          cachedResources,
          schemaToSelect,
          activeDriver,
        );
        const connectionKey = getConnectionSnapshotKey(
          connectionId,
          activeDriver,
        );
        const loadKey = getLoadKey(connectionId, activeDriver);
        const nodeKey = getConnectionMetadataNodeKey(
          connectionId,
          activeDriver,
        );
        set((state) => ({
          connectionSnapshots: {
            ...state.connectionSnapshots,
            [connectionKey]: {
              schemas: cachedSchemas,
              tables: [],
              collections: [],
              collectionNextCursor: null,
              collectionTotal: cachedRedisTotal,
              collectionFilter: "",
              functions: [],
              pinnedTables: schemaToSelect
                ? readPinnedTables(connectionId, schemaToSelect, activeDriver)
                : [],
              currentSchema: schemaToSelect,
              defaultSchema: savedDefault,
              selectedTable: null,
              lastLoadedConnectionId: loadKey,
              lastLoadedObjectKey: null,
              metadataVersion: state.metadataVersion,
            },
          },
          metadataNodeStates: {
            ...state.metadataNodeStates,
            [nodeKey]: {
              ...state.metadataNodeStates[nodeKey],
              status: "ready",
              source: "cache",
              message: `${cachedSchemas.length.toLocaleString()} ${cachedSchemas.length === 1 ? "schema" : "schemas"} from cache`,
              updatedAt: Date.now(),
            },
          },
        }));
        if (isMetadataRequestCurrent(request)) {
          get().restoreConnectionSnapshot(connectionId);
        }
        return true;
      } catch (error) {
        console.warn(
          "Store: Failed to hydrate connection metadata from cache",
          error,
        );
        return false;
      }
    },

    hydrateSchemaObjectsFromCache: async (
      connectionId: string,
      schema: string,
    ) => {
      if (!connectionId || !schema) return false;
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return false;

      const activeDriver = getConnectionDriver(connectionId);
      if (activeDriver === "redis") {
        // Redis keys are cursor data, not durable metadata. Reading a legacy
        // SQLite child set here can deserialize every cached key on connection
        // expansion, defeating the bounded SCAN path.
        const objectKey = getObjectSnapshotKey(
          connectionId,
          activeDriver,
          schema,
        );
        set((state) => {
          const objectSnapshots = { ...state.objectSnapshots };
          delete objectSnapshots[objectKey];
          const isActiveSchema =
            runtime.getConnectionState().activeConnectionId === connectionId &&
            state.currentSchema === schema;
          return {
            objectSnapshots,
            ...(isActiveSchema
              ? {
                  collections: [],
                  collectionNextCursor: null,
                  collectionTotal: null,
                  collectionLoadingKey: null,
                  collectionFilter: "",
                  lastLoadedObjectKey: null,
                }
              : {}),
          };
        });
        return false;
      }
      const schemaResourceId = getSchemaResourceId(
        connectionId,
        schema,
        activeDriver,
      );
      const nodeKey = getSchemaMetadataNodeKey(
        connectionId,
        activeDriver,
        schema,
      );

      try {
        const cachedResources = await storeService.getResources(
          connectionId,
          schemaResourceId,
          request.projectId,
        );
        if (!isMetadataRequestCurrent(request)) return false;
        const cachedTables = resourcesToTables(
          cachedResources,
          schema,
          activeDriver,
        );
        const cachedCollections = resourcesToCollections(
          cachedResources,
          schema,
          activeDriver,
        );
        const cachedFunctions = resourcesToFunctions(
          cachedResources,
          activeDriver,
        );
        const hasCachedTableGroup = hasCacheMarker(
          cachedResources,
          TABLE_CACHE_KIND,
          activeDriver,
        );
        const hasCachedCollectionGroup = hasCacheMarker(
          cachedResources,
          COLLECTION_CACHE_KIND,
          activeDriver,
        );
        const hasCachedFunctionGroup = hasCacheMarker(
          cachedResources,
          FUNCTION_CACHE_KIND,
          activeDriver,
        );
        const hasAnyCachedObject =
          cachedTables.length > 0 ||
          cachedCollections.length > 0 ||
          cachedFunctions.length > 0 ||
          hasCachedTableGroup ||
          hasCachedCollectionGroup ||
          hasCachedFunctionGroup;

        if (!hasAnyCachedObject) {
          get().setMetadataNodeState(nodeKey, {
            status: "stale",
            source: "cache",
            message: "No cached object metadata. Use Refresh to introspect.",
          });
          return false;
        }

        const savedPins = readPinnedTables(connectionId, schema, activeDriver);
        const objectKey = getObjectSnapshotKey(
          connectionId,
          activeDriver,
          schema,
        );
        const objectLoadKey =
          cachedTables.length > 0 || hasCachedTableGroup
            ? getObjectLoadKey(connectionId, activeDriver, schema, "tables")
            : cachedCollections.length > 0 || hasCachedCollectionGroup
              ? getObjectLoadKey(
                  connectionId,
                  activeDriver,
                  schema,
                  "collections",
                )
              : getObjectLoadKey(
                  connectionId,
                  activeDriver,
                  schema,
                  "functions",
                );

        set((state) => {
          const isActiveSchema =
            runtime.getConnectionState().activeConnectionId === connectionId &&
            state.currentSchema === schema;

          return {
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables: cachedTables,
                collections: cachedCollections,
                functions: cachedFunctions,
                pinnedTables: savedPins,
                selectedTable: isActiveSchema ? state.selectedTable : null,
                lastLoadedObjectKey: objectLoadKey,
              },
            },
            ...(isActiveSchema
              ? {
                  tables: cachedTables,
                  collections: cachedCollections,
                  functions: cachedFunctions,
                  pinnedTables: savedPins,
                  lastLoadedObjectKey: objectLoadKey,
                  isLoading: false,
                  isCollectionsLoading: false,
                  isFunctionsLoading: false,
                }
              : {}),
          };
        });
        get().setMetadataNodeState(nodeKey, {
          status: "ready",
          source: "cache",
          message: `${(
            cachedTables.length +
            cachedCollections.length +
            cachedFunctions.length
          ).toLocaleString()} objects from cache`,
        });
        return true;
      } catch (error) {
        if (!isMetadataRequestCurrent(request)) return false;
        console.warn(
          "Store: Failed to hydrate schema objects from cache",
          error,
        );
        get().setMetadataNodeState(nodeKey, {
          status: "error",
          source: "cache",
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    },
  };
};
