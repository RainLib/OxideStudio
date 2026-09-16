import { MAX_REDIS_KEYS_IN_MEMORY } from "@/features/schema-metadata/model/metadataCache";
import {
  getConnectionSnapshotKey,
  getObjectSnapshotKey,
} from "@/features/schema-metadata/model/metadataIdentity";

import type { SchemaSlice } from "./types";

export const createLifecycleSlice: SchemaSlice<
  | "setMetadataNodeState"
  | "markMetadataNodeStale"
  | "clearMetadataNodeState"
  | "clearActiveMetadata"
  | "reset"
  | "snapshotActiveMetadata"
  | "restoreConnectionSnapshot"
> = (set, get, runtime) => {
  const { getConnectionDriver, metadataRuntime } = runtime;
  return {
    setMetadataNodeState: (key, nodeState) => {
      set((state) => ({
        metadataNodeStates: {
          ...state.metadataNodeStates,
          [key]: {
            ...state.metadataNodeStates[key],
            ...nodeState,
            updatedAt: nodeState.updatedAt ?? Date.now(),
          },
        },
      }));
    },

    markMetadataNodeStale: (key, message) => {
      set((state) => ({
        metadataNodeStates: {
          ...state.metadataNodeStates,
          [key]: {
            ...state.metadataNodeStates[key],
            status: "stale",
            message: message || state.metadataNodeStates[key]?.message || null,
            updatedAt: Date.now(),
          },
        },
      }));
    },

    clearMetadataNodeState: (key) => {
      set((state) => {
        const next = { ...state.metadataNodeStates };
        delete next[key];
        return { metadataNodeStates: next };
      });
    },

    clearActiveMetadata: () => {
      set({
        schemas: [],
        tables: [],
        collections: [],
        collectionNextCursor: null,
        collectionTotal: null,
        collectionLoadingKey: null,
        collectionFilter: "",
        functions: [],
        pinnedTables: [],
        currentSchema: null,
        selectedTable: null,
        lastLoadedConnectionId: null,
        lastLoadedObjectKey: null,
        isLoading: false,
        isCollectionsLoading: false,
        isFunctionsLoading: false,
        metadataVersion: 0,
      });
    },

    reset: () => {
      metadataRuntime.generation += 1;
      metadataRuntime.namespaceSelectionGeneration += 1;
      set({
        schemas: [],
        tables: [],
        collections: [],
        collectionNextCursor: null,
        collectionTotal: null,
        collectionLoadingKey: null,
        collectionFilter: "",
        functions: [],
        pinnedTables: [],
        currentSchema: null,
        selectedTable: null,
        lastLoadedConnectionId: null,
        lastLoadedObjectKey: null,
        isLoading: false,
        isCollectionsLoading: false,
        isFunctionsLoading: false,
        metadataVersion: 0,
        connectionSnapshots: {},
        objectSnapshots: {},
        metadataNodeStates: {},
      });
    },

    snapshotActiveMetadata: () => {
      const { activeConnectionId } = runtime.getConnectionState();
      if (!activeConnectionId) return;

      const activeDriver = getConnectionDriver(activeConnectionId);
      const state = get();
      const snapshotCollections =
        activeDriver === "redis"
          ? state.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
          : state.collections;
      const snapshotLastLoadedObjectKey = state.lastLoadedObjectKey;
      const connectionKey = getConnectionSnapshotKey(
        activeConnectionId,
        activeDriver,
      );
      const nextConnectionSnapshots = {
        ...state.connectionSnapshots,
        [connectionKey]: {
          schemas: state.schemas,
          tables: state.tables,
          collections: snapshotCollections,
          collectionNextCursor: state.collectionNextCursor,
          collectionTotal: state.collectionTotal,
          collectionFilter: state.collectionFilter,
          functions: state.functions,
          pinnedTables: state.pinnedTables,
          currentSchema: state.currentSchema,
          defaultSchema: state.defaultSchema,
          selectedTable: state.selectedTable,
          lastLoadedConnectionId: state.lastLoadedConnectionId,
          lastLoadedObjectKey: snapshotLastLoadedObjectKey,
          metadataVersion: state.metadataVersion,
        },
      };

      let nextObjectSnapshots = state.objectSnapshots;
      if (state.currentSchema) {
        const objectKey = getObjectSnapshotKey(
          activeConnectionId,
          activeDriver,
          state.currentSchema,
        );
        nextObjectSnapshots = {
          ...state.objectSnapshots,
          [objectKey]: {
            tables: state.tables,
            collections: snapshotCollections,
            functions: state.functions,
            pinnedTables: state.pinnedTables,
            selectedTable: state.selectedTable,
            lastLoadedObjectKey: snapshotLastLoadedObjectKey,
          },
        };
      }

      set({
        connectionSnapshots: nextConnectionSnapshots,
        objectSnapshots: nextObjectSnapshots,
      });
    },

    restoreConnectionSnapshot: (connectionId: string) => {
      const activeDriver = getConnectionDriver(connectionId);
      const connectionKey = getConnectionSnapshotKey(
        connectionId,
        activeDriver,
      );
      const snapshot = get().connectionSnapshots[connectionKey];

      if (!snapshot) {
        get().clearActiveMetadata();
        return false;
      }

      set({
        schemas: snapshot.schemas,
        tables: snapshot.tables,
        // Legacy Redis snapshots may contain an unbounded key list. Retain only
        // the same safe window used by live pagination.
        collections:
          activeDriver === "redis"
            ? snapshot.collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
            : snapshot.collections,
        collectionNextCursor: snapshot.collectionNextCursor ?? null,
        collectionTotal: snapshot.collectionTotal ?? null,
        collectionLoadingKey: null,
        collectionFilter: snapshot.collectionFilter ?? "",
        functions: snapshot.functions,
        pinnedTables: snapshot.pinnedTables,
        currentSchema: snapshot.currentSchema,
        defaultSchema: snapshot.defaultSchema,
        selectedTable: snapshot.selectedTable,
        lastLoadedConnectionId: snapshot.lastLoadedConnectionId,
        lastLoadedObjectKey: snapshot.lastLoadedObjectKey,
        isLoading: false,
        isCollectionsLoading: false,
        isFunctionsLoading: false,
        metadataVersion: snapshot.metadataVersion,
      });

      return true;
    },
  };
};
