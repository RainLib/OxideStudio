import {
  createCacheMarker,
  FUNCTION_CACHE_KIND,
  hasCacheMarker,
  resourcesToFunctions,
} from "@/features/schema-metadata/model/metadataCache";
import {
  getObjectLoadKey,
  getObjectSnapshotKey,
  getSchemaResourceId,
} from "@/features/schema-metadata/model/metadataIdentity";

import { Resource, schemaService, storeService } from "@/services/tauri";
import type { SchemaSlice } from "./types";

export const createRoutineLoadingSlice: SchemaSlice<"loadFunctions"> = (
  set,
  get,
  runtime,
) => {
  const {
    getConnectionDriver,
    captureMetadataRequest,
    isMetadataRequestCurrent,
  } = runtime;
  return {
    loadFunctions: async (
      connectionId: string,
      schema: string,
      force = false,
    ) => {
      if (!connectionId || !schema) {
        set({ functions: [], isFunctionsLoading: false });
        return;
      }
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return;

      const activeDriver = getConnectionDriver(connectionId);
      const objectLoadKey = getObjectLoadKey(
        connectionId,
        activeDriver,
        schema,
        "functions",
      );
      const { lastLoadedObjectKey, currentSchema } = get();
      if (
        !force &&
        lastLoadedObjectKey === objectLoadKey &&
        currentSchema === schema
      ) {
        console.log("Store: loadFunctions skipped (cached in state)");
        return;
      }

      const schemaResourceId = getSchemaResourceId(
        connectionId,
        schema,
        activeDriver,
      );

      try {
        const cachedResources = await storeService.getResources(
          connectionId,
          schemaResourceId,
          request.projectId,
        );
        if (!isMetadataRequestCurrent(request)) return;
        const hasCachedFunctionGroup = hasCacheMarker(
          cachedResources,
          FUNCTION_CACHE_KIND,
          activeDriver,
        );

        if (!force && (cachedResources.length > 0 || hasCachedFunctionGroup)) {
          const cachedFunctions = resourcesToFunctions(
            cachedResources,
            activeDriver,
          );

          if (cachedFunctions.length === 0 && !hasCachedFunctionGroup) {
            throw new Error("Function cache is stale for active driver");
          }

          const currentSchema = get().currentSchema;
          if (!isMetadataRequestCurrent(request) || currentSchema !== schema) {
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
              functions: cachedFunctions,
              isFunctionsLoading: false,
              lastLoadedObjectKey: objectLoadKey,
              objectSnapshots: {
                ...state.objectSnapshots,
                [objectKey]: {
                  tables:
                    existingSnapshot?.tables ??
                    (state.currentSchema === schema ? state.tables : []),
                  collections:
                    existingSnapshot?.collections ??
                    (state.currentSchema === schema ? state.collections : []),
                  functions: cachedFunctions,
                  pinnedTables:
                    existingSnapshot?.pinnedTables ??
                    (state.currentSchema === schema ? state.pinnedTables : []),
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
          return;
        }
      } catch (e) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: Function MetaStore miss or error", e);
      }

      if (!isMetadataRequestCurrent(request)) return;
      set({ isFunctionsLoading: true });
      try {
        const functions = await schemaService.getFunctions(
          connectionId,
          schema,
        );
        const currentSchema = get().currentSchema;
        if (!isMetadataRequestCurrent(request) || currentSchema !== schema) {
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
            functions,
            isFunctionsLoading: false,
            lastLoadedObjectKey: objectLoadKey,
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables:
                  existingSnapshot?.tables ??
                  (state.currentSchema === schema ? state.tables : []),
                collections:
                  existingSnapshot?.collections ??
                  (state.currentSchema === schema ? state.collections : []),
                functions,
                pinnedTables:
                  existingSnapshot?.pinnedTables ??
                  (state.currentSchema === schema ? state.pinnedTables : []),
                selectedTable:
                  existingSnapshot?.selectedTable ??
                  (state.currentSchema === schema ? state.selectedTable : null),
                lastLoadedObjectKey: objectLoadKey,
              },
            },
          };
        });

        const newResources: Resource[] = functions.map((routine) => ({
          id: `${schemaResourceId}:${routine.name}`,
          connection_id: connectionId,
          parent_id: schemaResourceId,
          kind: "FUNCTION",
          name: routine.name,
          metadata: {
            driver: activeDriver,
            routine_type: routine.routine_type ?? null,
            parameters: routine.parameters ?? [],
            return_type: routine.return_type ?? "",
            description: routine.description ?? null,
          },
          last_updated: Date.now(),
        }));

        try {
          if (!isMetadataRequestCurrent(request)) return;
          await storeService.replaceResources(
            connectionId,
            schemaResourceId,
            "FUNCTION",
            newResources,
            request.projectId,
          );
          if (!isMetadataRequestCurrent(request)) return;
          await storeService.saveResources(
            [
              createCacheMarker(
                connectionId,
                schemaResourceId,
                FUNCTION_CACHE_KIND,
                activeDriver,
              ),
            ],
            request.projectId,
          );
        } catch (err) {
          if (!isMetadataRequestCurrent(request)) return;
          console.warn("Store: Failed to cache functions to MetaStore", err);
        }
      } catch (e) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: loadFunctions failed", e);
        const currentSchema = get().currentSchema;
        if (currentSchema !== schema) {
          return;
        }
        set({ functions: [], isFunctionsLoading: false });
      }
    },
  };
};
