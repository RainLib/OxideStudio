import {
  getConnectionSnapshotKey,
  getObjectSnapshotKey,
  getSchemaMetadataNodeKey,
  getSchemaResourceId,
  projectScopedKey,
} from "@/features/schema-metadata/model/metadataIdentity";
import { storeService } from "@/services/tauri";

import type { SchemaSlice } from "./types";

export const createCacheInvalidationSlice: SchemaSlice<
  "forgetConnectionMetadata" | "forgetSchemaMetadata"
> = (set, _get, runtime) => {
  const { getConnectionDriver } = runtime;
  return {
    forgetConnectionMetadata: async (connectionId: string) => {
      const activeDriver = getConnectionDriver(connectionId);
      await storeService.deleteResources(connectionId);

      set((state) => {
        const connectionSnapshotKey = getConnectionSnapshotKey(
          connectionId,
          activeDriver,
        );
        const snapshotPrefix = projectScopedKey(connectionId, activeDriver);
        const nodeConnectionPrefix = `connection:${snapshotPrefix}`;
        const nodeSchemaPrefix = `schema:${snapshotPrefix}:`;
        const nextConnectionSnapshots = { ...state.connectionSnapshots };
        const nextObjectSnapshots = { ...state.objectSnapshots };
        const nextNodeStates = { ...state.metadataNodeStates };

        delete nextConnectionSnapshots[connectionSnapshotKey];
        Object.keys(nextObjectSnapshots).forEach((key) => {
          if (key.startsWith(`${snapshotPrefix}:`)) {
            delete nextObjectSnapshots[key];
          }
        });
        Object.keys(nextNodeStates).forEach((key) => {
          if (
            key === nodeConnectionPrefix ||
            key.startsWith(nodeSchemaPrefix)
          ) {
            delete nextNodeStates[key];
          }
        });

        const isActiveConnection =
          runtime.getConnectionState().activeConnectionId === connectionId;

        return {
          connectionSnapshots: nextConnectionSnapshots,
          objectSnapshots: nextObjectSnapshots,
          metadataNodeStates: nextNodeStates,
          ...(isActiveConnection
            ? {
                schemas: [],
                tables: [],
                collections: [],
                functions: [],
                pinnedTables: [],
                currentSchema: null,
                selectedTable: null,
                lastLoadedConnectionId: null,
                lastLoadedObjectKey: null,
                isLoading: false,
                isCollectionsLoading: false,
                isFunctionsLoading: false,
                metadataVersion: state.metadataVersion + 1,
              }
            : {}),
        };
      });
    },

    forgetSchemaMetadata: async (connectionId: string, schema: string) => {
      const activeDriver = getConnectionDriver(connectionId);
      const schemaResourceId = getSchemaResourceId(
        connectionId,
        schema,
        activeDriver,
      );
      const schemaResources = await storeService
        .getResources(connectionId, schemaResourceId)
        .catch(() => []);
      await Promise.all(
        schemaResources.map((resource) =>
          storeService.deleteResources(connectionId, resource.id),
        ),
      );
      await storeService.deleteResources(connectionId, schemaResourceId);

      set((state) => {
        const objectKey = getObjectSnapshotKey(
          connectionId,
          activeDriver,
          schema,
        );
        const nodeKey = getSchemaMetadataNodeKey(
          connectionId,
          activeDriver,
          schema,
        );
        const nextObjectSnapshots = { ...state.objectSnapshots };
        const nextNodeStates = { ...state.metadataNodeStates };
        delete nextObjectSnapshots[objectKey];
        delete nextNodeStates[nodeKey];

        const isActiveSchema =
          runtime.getConnectionState().activeConnectionId === connectionId &&
          state.currentSchema === schema;

        return {
          objectSnapshots: nextObjectSnapshots,
          metadataNodeStates: nextNodeStates,
          ...(isActiveSchema
            ? {
                tables: [],
                collections: [],
                functions: [],
                pinnedTables: [],
                selectedTable: null,
                lastLoadedObjectKey: null,
                isLoading: false,
                isCollectionsLoading: false,
                isFunctionsLoading: false,
                metadataVersion: state.metadataVersion + 1,
              }
            : {}),
        };
      });
    },
  };
};
