import {
  createCacheMarker,
  hasCacheMarker,
  resourcesToTables,
  TABLE_CACHE_KIND,
} from "@/features/schema-metadata/model/metadataCache";
import {
  getObjectLoadKey,
  getObjectSnapshotKey,
  getPinnedTablesKey,
  getSchemaMetadataNodeKey,
  getSchemaResourceId,
  readStorageItem,
} from "@/features/schema-metadata/model/metadataIdentity";
import { type MetadataLoadFlight } from "@/features/schema-metadata/model/types";

import { Resource, schemaService, storeService } from "@/services/tauri";
import { useTaskStore } from "@/store/useTaskStore";
import type { SchemaSlice } from "./types";

export const createTableLoadingSlice: SchemaSlice<"loadTables"> = (
  set,
  get,
  runtime,
) => {
  const {
    getConnectionDriver,
    captureMetadataRequest,
    isMetadataRequestCurrent,
    metadataRequestKey,
    tableLoadsInFlight,
  } = runtime;
  return {
    loadTables: async (connectionId: string, schema: string, force = false) => {
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return;
      const requestKey = metadataRequestKey(request, "tables", schema);
      const pendingLoad = tableLoadsInFlight.get(requestKey);
      if (pendingLoad) {
        await pendingLoad.promise;
        if (
          force &&
          !pendingLoad.force &&
          isMetadataRequestCurrent(request) &&
          get().currentSchema === schema
        ) {
          await get().loadTables(connectionId, schema, true);
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
      tableLoadsInFlight.set(requestKey, loadFlight);

      try {
        console.log("Store: loadTables called (MetaStore aware)", {
          connectionId,
          schema,
          force,
        });
        const activeDriver = getConnectionDriver(connectionId);
        const nodeKey = getSchemaMetadataNodeKey(
          connectionId,
          activeDriver,
          schema,
        );
        const objectLoadKey = getObjectLoadKey(
          connectionId,
          activeDriver,
          schema,
          "tables",
        );
        const { lastLoadedObjectKey, currentSchema } = get();
        if (
          !force &&
          lastLoadedObjectKey === objectLoadKey &&
          currentSchema === schema
        ) {
          console.log("Store: loadTables skipped (cached in state)");
          return;
        }

        // Load pinned tables for this context
        const pinKey = getPinnedTablesKey(connectionId, schema, activeDriver);
        const savedPins = JSON.parse(readStorageItem(pinKey) || "[]");
        set({ pinnedTables: savedPins });

        // Parent ID for tables is scoped by connection + driver + schema.
        const schemaResourceId = getSchemaResourceId(
          connectionId,
          schema,
          activeDriver,
        );

        let hasCachedTableSnapshot = false;

        // 1. Try MetaStore Cache First
        try {
          const cachedResources = await storeService.getResources(
            connectionId,
            schemaResourceId,
            request.projectId,
          );
          if (!isMetadataRequestCurrent(request)) return;

          const hasCachedTableGroup = hasCacheMarker(
            cachedResources,
            TABLE_CACHE_KIND,
            activeDriver,
          );

          if (cachedResources.length > 0 || hasCachedTableGroup) {
            const cachedTables = resourcesToTables(
              cachedResources,
              schema,
              activeDriver,
            );

            if (cachedTables.length === 0 && !hasCachedTableGroup) {
              throw new Error("Table cache is stale for active driver");
            }

            hasCachedTableSnapshot = true;
            console.log(
              "Store: Loaded tables from MetaStore",
              cachedTables.length,
            );
            get().setMetadataNodeState(nodeKey, {
              status: "ready",
              source: "cache",
              message: `${cachedTables.length.toLocaleString()} ${cachedTables.length === 1 ? "table" : "tables"} from cache`,
            });
            set((state) => {
              const objectKey = getObjectSnapshotKey(
                connectionId,
                activeDriver,
                schema,
              );
              const existingSnapshot = state.objectSnapshots[objectKey];

              return {
                tables: cachedTables,
                isLoading: false,
                lastLoadedObjectKey: objectLoadKey,
                objectSnapshots: {
                  ...state.objectSnapshots,
                  [objectKey]: {
                    tables: cachedTables,
                    collections:
                      existingSnapshot?.collections ??
                      (state.currentSchema === schema ? state.collections : []),
                    functions:
                      existingSnapshot?.functions ??
                      (state.currentSchema === schema ? state.functions : []),
                    pinnedTables: savedPins,
                    selectedTable:
                      existingSnapshot?.selectedTable ??
                      (state.currentSchema === schema
                        ? state.selectedTable
                        : null),
                    lastLoadedObjectKey: objectLoadKey,
                  },
                },
              };
            });
            if (!force) return;
          }
        } catch (e) {
          if (!isMetadataRequestCurrent(request)) return;
          console.warn("Store: Table MetaStore miss or error", e);
        }

        // 2. Refresh from Driver & Update MetaStore
        if (!isMetadataRequestCurrent(request)) return;
        const hasUsableTables =
          hasCachedTableSnapshot || get().tables.length > 0;
        set({ isLoading: !hasUsableTables });
        get().setMetadataNodeState(nodeKey, {
          status: hasUsableTables ? "ready" : "loading",
          source: hasUsableTables ? "cache" : "remote",
          message: hasUsableTables
            ? `Refreshing ${schema} in background`
            : `Refreshing ${schema}`,
        });
        const taskStore = useTaskStore.getState();
        const taskId = taskStore.startTask({
          kind: "introspection",
          title: `Refresh ${schema}`,
          detail: "Tables",
        });
        try {
          const tables = await schemaService.refreshTables(
            connectionId,
            schema,
          );
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          set((state) => {
            const objectKey = getObjectSnapshotKey(
              connectionId,
              activeDriver,
              schema,
            );
            const existingSnapshot = state.objectSnapshots[objectKey];

            return {
              tables: tables,
              isLoading: false,
              lastLoadedObjectKey: objectLoadKey,
              metadataVersion: state.metadataVersion + 1,
              objectSnapshots: {
                ...state.objectSnapshots,
                [objectKey]: {
                  tables,
                  collections:
                    existingSnapshot?.collections ??
                    (state.currentSchema === schema ? state.collections : []),
                  functions:
                    existingSnapshot?.functions ??
                    (state.currentSchema === schema ? state.functions : []),
                  pinnedTables: savedPins,
                  selectedTable:
                    existingSnapshot?.selectedTable ??
                    (state.currentSchema === schema
                      ? state.selectedTable
                      : null),
                  lastLoadedObjectKey: objectLoadKey,
                },
              },
            };
          });
          get().setMetadataNodeState(nodeKey, {
            status: "ready",
            source: "remote",
            message: `${tables.length.toLocaleString()} ${tables.length === 1 ? "table" : "tables"}`,
          });

          // Save to MetaStore in background
          const newResources: Resource[] = tables.map((t) => ({
            id: `${schemaResourceId}:${t.name}`,
            connection_id: connectionId,
            parent_id: schemaResourceId,
            kind: "TABLE",
            name: t.name,
            metadata: {
              driver: activeDriver,
              type: t.type,
              comment: t.comment,
            },
            last_updated: Date.now(),
          }));

          try {
            if (!isMetadataRequestCurrent(request)) {
              taskStore.cancelTask(taskId, "Metadata context changed");
              return;
            }
            await storeService.replaceResources(
              connectionId,
              schemaResourceId,
              "TABLE",
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
                  schemaResourceId,
                  TABLE_CACHE_KIND,
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
            console.warn("Store: Failed to cache tables to MetaStore", err);
          }
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          taskStore.finishTask(
            taskId,
            `${tables.length.toLocaleString()} tables`,
          );
        } catch (e) {
          if (!isMetadataRequestCurrent(request)) {
            taskStore.cancelTask(taskId, "Metadata context changed");
            return;
          }
          const errorMessage = e instanceof Error ? e.message : String(e);
          taskStore.failTask(taskId, errorMessage);
          const hasCachedTables =
            hasCachedTableSnapshot || get().tables.length > 0;
          get().setMetadataNodeState(nodeKey, {
            status: hasCachedTables ? "stale" : "error",
            source: hasCachedTables ? "cache" : "remote",
            message: hasCachedTables
              ? `Refresh failed; showing cached tables. ${errorMessage}`
              : errorMessage,
          });
          console.warn("Store: loadTables refresh failed", e);
          set((state) => ({
            isLoading: false,
            ...(state.tables.length === 0 ? { tables: [] } : {}),
          }));
        }
      } finally {
        if (tableLoadsInFlight.get(requestKey) === loadFlight) {
          tableLoadsInFlight.delete(requestKey);
        }
        completeLoad();
      }
    },
  };
};
