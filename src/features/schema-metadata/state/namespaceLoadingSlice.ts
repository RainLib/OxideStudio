import {
  createCacheMarker,
  hasCacheMarker,
  MAX_REDIS_KEYS_IN_MEMORY,
  redisTotalFromResources,
  resourceMatchesDriver,
  SCHEMA_CACHE_KIND,
} from "@/features/schema-metadata/model/metadataCache";
import {
  getConnectionMetadataNodeKey,
  getConnectionSnapshotKey,
  getLoadKey,
  getSavedDefaultSchema,
  getSchemaResourceId,
} from "@/features/schema-metadata/model/metadataIdentity";
import { type MetadataLoadFlight } from "@/features/schema-metadata/model/types";
import { activateBackendSchema } from "@/features/schema-metadata/runtime/activateBackendSchema";

import {
  connectionDatabaseNamespacePreference,
  selectPreferredNamespace,
} from "@/lib/databaseDialect";
import { Resource, schemaService, storeService } from "@/services/tauri";

import { useTaskStore } from "@/store/useTaskStore";
import type { SchemaSlice } from "./types";

export const createNamespaceLoadingSlice: SchemaSlice<"loadSchemas"> = (
  set,
  get,
  runtime,
) => {
  const {
    captureMetadataRequest,
    isMetadataRequestCurrent,
    metadataRequestKey,
    schemaLoadsInFlight,
  } = runtime;
  return {
    loadSchemas: async (connectionId: string, force = false) => {
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return;
      const requestKey = metadataRequestKey(request, "schemas");
      const pendingLoad = schemaLoadsInFlight.get(requestKey);
      if (pendingLoad) {
        await pendingLoad.promise;
        if (force && !pendingLoad.force && isMetadataRequestCurrent(request)) {
          await get().loadSchemas(connectionId, true);
        }
        return;
      }
      let completeLoad = () => {};
      const loadCompletion = new Promise<void>((resolve) => {
        completeLoad = resolve;
      });
      const loadFlight: MetadataLoadFlight = {
        force,
        promise: loadCompletion,
      };
      schemaLoadsInFlight.set(requestKey, loadFlight);

      try {
        const { lastLoadedConnectionId, isLoading } = get();
        const connections = runtime.getConnectionState().connections;
        const activeConn = connections.find((c) => c.id === connectionId);
        const activeDriver = activeConn?.driver || null;
        const configDefault = connectionDatabaseNamespacePreference(
          activeDriver,
          activeConn?.database,
        );
        const savedDefault = getSavedDefaultSchema(connectionId, activeDriver);
        const loadKey = getLoadKey(connectionId, activeDriver);
        const nodeKey = getConnectionMetadataNodeKey(
          connectionId,
          activeDriver,
        );

        // Prevent duplicate calls if we're already loading or if the connection hasn't changed (unless forced)
        if (
          (isLoading && lastLoadedConnectionId === loadKey) ||
          (lastLoadedConnectionId === loadKey && !force)
        ) {
          console.log("Store: loadSchemas skipped (redundant)");
          return;
        }

        console.log(
          "Store: loadSchemas called (MetaStore aware) for:",
          connectionId,
        );
        set({
          lastLoadedConnectionId: loadKey,
        });

        let hasCachedSchemaSnapshot = false;

        // 1. Try MetaStore Cache First (SQLite)
        try {
          // Fetch DB resources (parent_id = null)
          const cachedResources = await storeService.getResources(
            connectionId,
            undefined,
            request.projectId,
          );
          if (!isMetadataRequestCurrent(request)) return;
          const cachedSchemas = cachedResources
            .filter(
              (resource) =>
                resource.kind === "DATABASE" &&
                resourceMatchesDriver(resource, activeDriver),
            )
            .map((r) => r.name);

          if (
            (cachedSchemas && cachedSchemas.length > 0) ||
            hasCacheMarker(cachedResources, SCHEMA_CACHE_KIND, activeDriver)
          ) {
            hasCachedSchemaSnapshot = true;
            console.log(
              "Store: Loaded schemas from MetaStore",
              cachedSchemas.length,
            );
            const currentSchema = get().currentSchema;
            const schemaToSelect = selectPreferredNamespace(
              activeDriver,
              cachedSchemas,
              [currentSchema, configDefault, savedDefault],
            );
            set({
              schemas: cachedSchemas,
              currentSchema: schemaToSelect,
              defaultSchema: savedDefault,
              ...(activeDriver === "redis"
                ? {
                    collectionTotal:
                      redisTotalFromResources(
                        cachedResources,
                        schemaToSelect,
                        activeDriver,
                      ) ?? get().collectionTotal,
                  }
                : {}),
              // Cached metadata is usable immediately. A forced remote refresh is
              // represented by the node state and must not block cached children.
              isLoading: false,
            });
            get().setMetadataNodeState(nodeKey, {
              status: "ready",
              source: "cache",
              message: `${cachedSchemas.length.toLocaleString()} ${cachedSchemas.length === 1 ? "schema" : "schemas"} from cache`,
            });
            set((state) => ({
              connectionSnapshots: {
                ...state.connectionSnapshots,
                [getConnectionSnapshotKey(connectionId, activeDriver)]: {
                  schemas: cachedSchemas,
                  tables: state.tables,
                  collections:
                    activeDriver === "redis"
                      ? state.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
                      : state.collections,
                  collectionNextCursor: state.collectionNextCursor,
                  collectionTotal: state.collectionTotal,
                  collectionFilter: state.collectionFilter,
                  functions: state.functions,
                  pinnedTables: state.pinnedTables,
                  currentSchema: schemaToSelect,
                  defaultSchema: savedDefault,
                  selectedTable: state.selectedTable,
                  lastLoadedConnectionId: loadKey,
                  lastLoadedObjectKey: state.lastLoadedObjectKey,
                  metadataVersion: state.metadataVersion,
                },
              },
            }));

            const schemaActivated = await activateBackendSchema(
              connectionId,
              schemaToSelect,
            );
            if (!isMetadataRequestCurrent(request)) return;
            if (!schemaActivated && !force) {
              throw new Error(
                "Cached schema could not be activated on backend",
              );
            }

            // If we found data, we rely on user to trigger explicit refresh if needed
            // OR we could background refresh. User requirement: "Update only when triggered".
            // So we STOP here if cache hit.
            if (!force) return;
          }
        } catch (e) {
          if (!isMetadataRequestCurrent(request)) return;
          console.warn("Store: MetaStore cache miss or error", e);
        }

        // 2. Refresh from Driver & Update MetaStore (Only if cache miss or forced)
        if (!isMetadataRequestCurrent(request)) return;
        set({ isLoading: !hasCachedSchemaSnapshot });
        get().setMetadataNodeState(nodeKey, {
          status: hasCachedSchemaSnapshot ? "ready" : "loading",
          source: hasCachedSchemaSnapshot ? "cache" : "remote",
          message: hasCachedSchemaSnapshot
            ? "Refreshing schemas in background"
            : "Refreshing schemas",
        });
        console.log("Store: Refreshing schemas from Driver...");
        const taskStore = useTaskStore.getState();
        const taskId = taskStore.startTask({
          kind: "introspection",
          title: `Refresh ${activeConn?.name || "data source"}`,
          detail: "Schemas",
        });
        try {
          const schemas = await schemaService.refreshSchemas(connectionId);
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          console.log("Store: loadSchemas Refresh result:", schemas);

          if (schemas) {
            // Optimistically update UI first
            const currentSchema = get().currentSchema;
            const schemaToSelect = selectPreferredNamespace(
              activeDriver,
              schemas,
              [currentSchema, configDefault, savedDefault],
            );
            await activateBackendSchema(connectionId, schemaToSelect);
            if (!isMetadataRequestCurrent(request)) {
              taskStore.cancelTask(taskId, "Metadata context changed");
              return;
            }

            set({
              schemas: schemas,
              currentSchema: schemaToSelect || null,
              defaultSchema: savedDefault,
              isLoading: false,
              selectedTable: null,
              collections:
                activeDriver === "redis" && schemaToSelect === currentSchema
                  ? get().collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
                  : [],
              tables:
                currentSchema && schemas.includes(currentSchema)
                  ? get().tables
                  : [],
            });
            set((state) => ({
              connectionSnapshots: {
                ...state.connectionSnapshots,
                [getConnectionSnapshotKey(connectionId, activeDriver)]: {
                  schemas,
                  tables: state.tables,
                  collections:
                    activeDriver === "redis"
                      ? state.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
                      : state.collections,
                  collectionNextCursor: state.collectionNextCursor,
                  collectionTotal: state.collectionTotal,
                  collectionFilter: state.collectionFilter,
                  functions: state.functions,
                  pinnedTables: state.pinnedTables,
                  currentSchema: schemaToSelect || null,
                  defaultSchema: savedDefault,
                  selectedTable: state.selectedTable,
                  lastLoadedConnectionId: loadKey,
                  lastLoadedObjectKey: state.lastLoadedObjectKey,
                  metadataVersion: state.metadataVersion,
                },
              },
            }));
            get().setMetadataNodeState(nodeKey, {
              status: "ready",
              source: "remote",
              message: `${schemas.length.toLocaleString()} ${schemas.length === 1 ? "schema" : "schemas"}`,
            });

            // Save to MetaStore in background
            const newResources: Resource[] = schemas.map((name) => ({
              id: getSchemaResourceId(connectionId, name, activeDriver),
              connection_id: connectionId,
              kind: "DATABASE",
              name: name,
              metadata: { driver: activeDriver },
              last_updated: Date.now(),
            }));

            try {
              if (!isMetadataRequestCurrent(request)) {
                taskStore.cancelTask(taskId, "Metadata context changed");
                return;
              }
              await storeService.replaceResources(
                connectionId,
                undefined,
                "DATABASE",
                newResources,
                request.projectId,
              );
              if (!isMetadataRequestCurrent(request)) {
                taskStore.cancelTask(taskId, "Metadata context changed");
                return;
              }
              await storeService.saveResources(
                [
                  createCacheMarker(
                    connectionId,
                    undefined,
                    SCHEMA_CACHE_KIND,
                    activeDriver,
                  ),
                ],
                request.projectId,
              );
              if (!isMetadataRequestCurrent(request)) {
                taskStore.cancelTask(taskId, "Metadata context changed");
                return;
              }
            } catch (err) {
              console.warn("Store: Failed to cache schemas to MetaStore", err);
            }
          }
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          taskStore.finishTask(
            taskId,
            `${schemas.length.toLocaleString()} schemas`,
          );
        } catch (e) {
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          const errorMessage = e instanceof Error ? e.message : String(e);
          taskStore.failTask(taskId, errorMessage);
          const hasCachedSchemas =
            hasCachedSchemaSnapshot || get().schemas.length > 0;
          get().setMetadataNodeState(nodeKey, {
            status: hasCachedSchemas ? "stale" : "error",
            source: hasCachedSchemas ? "cache" : "remote",
            message: hasCachedSchemas
              ? `Refresh failed; showing cached schemas. ${errorMessage}`
              : errorMessage,
          });
          console.warn("Store: loadSchemas refresh failed", e);
          // A failed background refresh never hides or clears usable cache.
          set((state) => ({
            isLoading: false,
            ...(state.schemas.length === 0 ? { schemas: [] } : {}),
          }));
        }
      } finally {
        if (schemaLoadsInFlight.get(requestKey) === loadFlight) {
          schemaLoadsInFlight.delete(requestKey);
        }
        completeLoad();
      }
    },
  };
};
