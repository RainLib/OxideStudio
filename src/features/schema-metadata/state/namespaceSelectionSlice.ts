import {
  COLLECTION_CACHE_KIND,
  FUNCTION_CACHE_KIND,
  hasCacheMarker,
  resourcesToCollections,
  resourcesToFunctions,
  resourcesToTables,
  TABLE_CACHE_KIND,
} from "@/features/schema-metadata/model/metadataCache";
import {
  getDefaultSchemaKey,
  getObjectLoadKey,
  getObjectSnapshotKey,
  getPinnedTablesKey,
  getSchemaResourceId,
  readStorageItem,
  writeStorageItem,
} from "@/features/schema-metadata/model/metadataIdentity";

import { schemaService, storeService } from "@/services/tauri";

import type { SchemaSlice } from "./types";

export const createNamespaceSelectionSlice: SchemaSlice<
  | "bumpMetadataVersion"
  | "togglePinTable"
  | "setCurrentSchema"
  | "setDefaultSchema"
  | "selectTable"
> = (set, get, runtime) => {
  const {
    getConnectionDriver,
    captureMetadataRequest,
    isMetadataRequestCurrent,
    metadataRuntime,
  } = runtime;
  return {
    bumpMetadataVersion: () => {
      set((state) => ({ metadataVersion: state.metadataVersion + 1 }));
    },

    togglePinTable: (tableName: string) => {
      const { activeConnectionId } = runtime.getConnectionState();
      const { currentSchema, pinnedTables } = get();
      if (!activeConnectionId || !currentSchema) return;
      const activeDriver = getConnectionDriver(activeConnectionId);

      const pinKey = getPinnedTablesKey(
        activeConnectionId,
        currentSchema,
        activeDriver,
      );
      const isPinned = pinnedTables.includes(tableName);
      const newPinned = isPinned
        ? pinnedTables.filter((t) => t !== tableName)
        : [...pinnedTables, tableName];

      writeStorageItem(pinKey, JSON.stringify(newPinned));
      set({ pinnedTables: newPinned });
    },

    setCurrentSchema: async (schema: string) => {
      const selectionGeneration =
        ++metadataRuntime.namespaceSelectionGeneration;
      const selectionIsCurrent = () =>
        selectionGeneration === metadataRuntime.namespaceSelectionGeneration;
      const { activeConnectionId } = runtime.getConnectionState();
      const request = activeConnectionId
        ? captureMetadataRequest(activeConnectionId)
        : null;
      if (
        (request && !isMetadataRequestCurrent(request)) ||
        !selectionIsCurrent()
      )
        return;
      const activeDriver = activeConnectionId
        ? getConnectionDriver(activeConnectionId)
        : null;
      const currentState = get();
      const previous = {
        currentSchema: currentState.currentSchema,
        selectedTable: currentState.selectedTable,
        tables: currentState.tables,
        collections: currentState.collections,
        functions: currentState.functions,
        pinnedTables: currentState.pinnedTables,
        lastLoadedObjectKey: currentState.lastLoadedObjectKey,
        isCollectionsLoading: currentState.isCollectionsLoading,
        isFunctionsLoading: currentState.isFunctionsLoading,
        objectSnapshots: currentState.objectSnapshots,
      };
      let nextObjectSnapshots = currentState.objectSnapshots;

      if (activeConnectionId && currentState.currentSchema) {
        const previousObjectKey = getObjectSnapshotKey(
          activeConnectionId,
          activeDriver,
          currentState.currentSchema,
        );
        nextObjectSnapshots = {
          ...nextObjectSnapshots,
          [previousObjectKey]: {
            tables: currentState.tables,
            collections:
              activeDriver === "redis" ? [] : currentState.collections,
            functions: currentState.functions,
            pinnedTables: currentState.pinnedTables,
            selectedTable: currentState.selectedTable,
            lastLoadedObjectKey: currentState.lastLoadedObjectKey,
          },
        };
      }

      let targetObjectSnapshot =
        activeDriver !== "redis" && activeConnectionId && schema
          ? (nextObjectSnapshots[
              getObjectSnapshotKey(activeConnectionId, activeDriver, schema)
            ] ?? null)
          : null;

      // Switch the visible namespace before waiting for SQLite cache hydration
      // or the backend USE/SELECT call. Explorer rows must acknowledge the click
      // immediately; cached or remote children can arrive afterwards.
      set({
        currentSchema: schema,
        selectedTable: targetObjectSnapshot?.selectedTable ?? null,
        tables: targetObjectSnapshot?.tables ?? [],
        collections: targetObjectSnapshot?.collections ?? [],
        collectionNextCursor: null,
        collectionTotal: null,
        collectionLoadingKey: null,
        collectionFilter: "",
        functions: targetObjectSnapshot?.functions ?? [],
        pinnedTables: targetObjectSnapshot?.pinnedTables ?? [],
        lastLoadedObjectKey: targetObjectSnapshot?.lastLoadedObjectKey ?? null,
        isCollectionsLoading: false,
        isFunctionsLoading: false,
        objectSnapshots: nextObjectSnapshots,
      });

      if (
        activeConnectionId &&
        schema &&
        activeDriver !== "redis" &&
        !targetObjectSnapshot
      ) {
        try {
          const schemaResourceId = getSchemaResourceId(
            activeConnectionId,
            schema,
            activeDriver,
          );
          const cachedResources = await storeService.getResources(
            activeConnectionId,
            schemaResourceId,
            request?.projectId,
          );
          if (
            (request && !isMetadataRequestCurrent(request)) ||
            !selectionIsCurrent()
          )
            return;
          const cachedTables = resourcesToTables(
            cachedResources,
            schema,
            activeDriver,
          );
          const cachedCollections =
            activeDriver === "redis"
              ? []
              : resourcesToCollections(cachedResources, schema, activeDriver);
          const cachedFunctions = resourcesToFunctions(
            cachedResources,
            activeDriver,
          );
          const hasCachedTableGroup = hasCacheMarker(
            cachedResources,
            TABLE_CACHE_KIND,
            activeDriver,
          );
          const hasCachedCollectionGroup =
            activeDriver !== "redis" &&
            hasCacheMarker(
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

          if (hasAnyCachedObject) {
            const pinKey = getPinnedTablesKey(
              activeConnectionId,
              schema,
              activeDriver,
            );
            const parsedPins = JSON.parse(readStorageItem(pinKey) || "[]");
            const savedPins = Array.isArray(parsedPins)
              ? parsedPins.filter(
                  (value): value is string => typeof value === "string",
                )
              : [];
            const lastLoadedObjectKey =
              cachedTables.length > 0 || hasCachedTableGroup
                ? getObjectLoadKey(
                    activeConnectionId,
                    activeDriver,
                    schema,
                    "tables",
                  )
                : cachedCollections.length > 0 || hasCachedCollectionGroup
                  ? getObjectLoadKey(
                      activeConnectionId,
                      activeDriver,
                      schema,
                      "collections",
                    )
                  : cachedFunctions.length > 0 || hasCachedFunctionGroup
                    ? getObjectLoadKey(
                        activeConnectionId,
                        activeDriver,
                        schema,
                        "functions",
                      )
                    : currentState.lastLoadedObjectKey;
            const objectKey = getObjectSnapshotKey(
              activeConnectionId,
              activeDriver,
              schema,
            );

            targetObjectSnapshot = {
              tables: cachedTables,
              collections: cachedCollections,
              functions: cachedFunctions,
              pinnedTables: savedPins,
              selectedTable: null,
              lastLoadedObjectKey,
            };
            nextObjectSnapshots = {
              ...nextObjectSnapshots,
              [objectKey]: targetObjectSnapshot,
            };
          }
        } catch (error) {
          if (
            (request && !isMetadataRequestCurrent(request)) ||
            !selectionIsCurrent()
          )
            return;
          console.warn(
            "Store: Failed to hydrate schema objects from MetaStore",
            error,
          );
        }
      }

      if (
        (request && !isMetadataRequestCurrent(request)) ||
        !selectionIsCurrent()
      )
        return;
      set({
        currentSchema: schema,
        selectedTable: targetObjectSnapshot?.selectedTable ?? null,
        tables: targetObjectSnapshot?.tables ?? [],
        collections: targetObjectSnapshot?.collections ?? [],
        collectionNextCursor: null,
        collectionTotal: null,
        collectionLoadingKey: null,
        collectionFilter: "",
        functions: targetObjectSnapshot?.functions ?? [],
        pinnedTables: targetObjectSnapshot?.pinnedTables ?? [],
        lastLoadedObjectKey: targetObjectSnapshot?.lastLoadedObjectKey ?? null,
        isCollectionsLoading: false,
        isFunctionsLoading: false,
        objectSnapshots: nextObjectSnapshots,
      });

      if (activeConnectionId && schema) {
        try {
          await schemaService.setCurrentSchema(activeConnectionId, schema);
          if (
            (request && !isMetadataRequestCurrent(request)) ||
            !selectionIsCurrent()
          ) {
            const latestSchema = get().currentSchema;
            if (
              latestSchema &&
              runtime.getConnectionState().activeConnectionId ===
                activeConnectionId
            ) {
              await schemaService
                .setCurrentSchema(activeConnectionId, latestSchema)
                .catch((error) =>
                  console.warn(
                    "Store: Failed to restore the latest backend schema",
                    error,
                  ),
                );
            }
            return;
          }
        } catch (error) {
          if (
            (request && !isMetadataRequestCurrent(request)) ||
            !selectionIsCurrent()
          )
            return;
          set(previous);
          throw error;
        }
      }
    },

    setDefaultSchema: async (schema: string) => {
      console.log("Store: setDefaultSchema called with:", schema);
      const { activeConnectionId } = runtime.getConnectionState();
      if (activeConnectionId) {
        await get().setCurrentSchema(schema);
        writeStorageItem(
          getDefaultSchemaKey(
            activeConnectionId,
            getConnectionDriver(activeConnectionId),
          ),
          schema,
        );
      } else {
        set({ currentSchema: schema });
      }
      set({ defaultSchema: schema });
      console.log(
        "Store: setDefaultSchema - currentSchema updated to:",
        schema,
      );
    },

    selectTable: (table: string | null) => {
      set({ selectedTable: table });
    },
  };
};
