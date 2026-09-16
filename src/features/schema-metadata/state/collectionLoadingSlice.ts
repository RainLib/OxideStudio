import {
  COLLECTION_CACHE_KIND,
  createCacheMarker,
  hasCacheMarker,
  MAX_REDIS_KEYS_IN_MEMORY,
  REDIS_KEY_COUNT_CACHE_KIND,
  REDIS_KEY_PAGE_SIZE,
  resourcesToCollections,
} from "@/features/schema-metadata/model/metadataCache";
import {
  getObjectLoadKey,
  getObjectSnapshotKey,
  getSchemaResourceId,
} from "@/features/schema-metadata/model/metadataIdentity";

import { Resource, schemaService, storeService } from "@/services/tauri";
import type { SchemaSlice } from "./types";

export const createCollectionLoadingSlice: SchemaSlice<
  "loadCollections" | "loadMoreCollections"
> = (set, get, runtime) => {
  const {
    getConnectionDriver,
    captureMetadataRequest,
    isMetadataRequestCurrent,
  } = runtime;
  return {
    loadCollections: async (
      connectionId: string,
      namespace: string,
      force = false,
      filter = "",
      revalidateCached = false,
    ) => {
      if (!connectionId) {
        set({
          collections: [],
          collectionLoadingKey: null,
          isCollectionsLoading: false,
        });
        return;
      }
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return;

      const activeDriver = getConnectionDriver(connectionId);
      const normalizedFilter = activeDriver === "redis" ? filter.trim() : "";
      const objectLoadKey = getObjectLoadKey(
        connectionId,
        activeDriver,
        namespace || "",
        activeDriver === "redis"
          ? `collections:${normalizedFilter}`
          : "collections",
      );
      const { lastLoadedObjectKey, currentSchema: activeNamespace } = get();
      if (
        !force &&
        !revalidateCached &&
        lastLoadedObjectKey === objectLoadKey &&
        (activeNamespace || "") === namespace
      ) {
        console.log("Store: loadCollections skipped (cached in state)");
        return;
      }
      const schemaResourceId = getSchemaResourceId(
        connectionId,
        namespace || "",
        activeDriver,
      );
      if (get().collectionLoadingKey === objectLoadKey) {
        return;
      }
      set({
        isCollectionsLoading: true,
        collectionLoadingKey: objectLoadKey,
      });

      if (activeDriver === "redis") {
        try {
          const page = await schemaService.getCollectionsPage(
            connectionId,
            namespace || "",
            null,
            REDIS_KEY_PAGE_SIZE,
            normalizedFilter || null,
          );
          if (!isMetadataRequestCurrent(request)) return;
          const currentSchema = get().currentSchema;
          if (
            get().collectionLoadingKey !== objectLoadKey ||
            currentSchema !== namespace
          ) {
            set((state) =>
              state.collectionLoadingKey === objectLoadKey
                ? { isCollectionsLoading: false, collectionLoadingKey: null }
                : {},
            );
            return;
          }
          set({
            collections: page.items,
            collectionNextCursor: page.nextCursor || null,
            collectionTotal: page.total ?? null,
            collectionLoadingKey: null,
            collectionFilter: normalizedFilter,
            isCollectionsLoading: false,
            lastLoadedObjectKey: objectLoadKey,
          });
          if (!normalizedFilter && typeof page.total === "number") {
            try {
              await storeService.saveResources(
                [
                  {
                    id: `${connectionId}:${activeDriver}:${namespace || "0"}:${REDIS_KEY_COUNT_CACHE_KIND}`,
                    connection_id: connectionId,
                    kind: REDIS_KEY_COUNT_CACHE_KIND,
                    name: namespace || "0",
                    metadata: {
                      driver: activeDriver,
                      total: page.total,
                      loadedCount: page.items.length,
                    },
                    last_updated: Date.now(),
                  },
                ],
                request.projectId,
              );
            } catch (cacheError) {
              console.warn(
                "Store: Failed to cache Redis key count",
                cacheError,
              );
            }
          }
        } catch (error) {
          if (!isMetadataRequestCurrent(request)) return;
          console.warn("Store: Redis key page failed", error);
          set((state) =>
            state.collectionLoadingKey === objectLoadKey
              ? {
                  collections: [],
                  collectionNextCursor: null,
                  collectionTotal: null,
                  collectionLoadingKey: null,
                  collectionFilter: normalizedFilter,
                  isCollectionsLoading: false,
                }
              : {},
          );
        }
        return;
      }

      try {
        const cachedResources = await storeService.getResources(
          connectionId,
          schemaResourceId,
          request.projectId,
        );
        if (!isMetadataRequestCurrent(request)) return;

        const hasCachedCollectionGroup = hasCacheMarker(
          cachedResources,
          COLLECTION_CACHE_KIND,
          activeDriver,
        );

        if (
          !force &&
          (cachedResources.length > 0 || hasCachedCollectionGroup)
        ) {
          const cachedCollections = resourcesToCollections(
            cachedResources,
            namespace,
            activeDriver,
          );

          if (cachedCollections.length === 0 && !hasCachedCollectionGroup) {
            throw new Error("Collection cache is stale for active driver");
          }
          if (activeDriver === "redis" && cachedCollections.length === 0) {
            throw new Error(
              "Redis key cache is empty; refresh from the server",
            );
          }

          const currentSchema = get().currentSchema;
          if (
            !isMetadataRequestCurrent(request) ||
            currentSchema !== namespace
          ) {
            return;
          }

          set((state) => {
            const objectKey = getObjectSnapshotKey(
              connectionId,
              activeDriver,
              namespace || "",
            );
            const existingSnapshot = state.objectSnapshots[objectKey];

            return {
              collections: cachedCollections,
              isCollectionsLoading: revalidateCached,
              collectionLoadingKey: revalidateCached ? objectLoadKey : null,
              lastLoadedObjectKey: objectLoadKey,
              objectSnapshots: {
                ...state.objectSnapshots,
                [objectKey]: {
                  tables:
                    existingSnapshot?.tables ??
                    ((state.currentSchema || "") === namespace
                      ? state.tables
                      : []),
                  collections: cachedCollections,
                  functions:
                    existingSnapshot?.functions ??
                    ((state.currentSchema || "") === namespace
                      ? state.functions
                      : []),
                  pinnedTables:
                    existingSnapshot?.pinnedTables ??
                    ((state.currentSchema || "") === namespace
                      ? state.pinnedTables
                      : []),
                  selectedTable:
                    existingSnapshot?.selectedTable ??
                    ((state.currentSchema || "") === namespace
                      ? state.selectedTable
                      : null),
                  lastLoadedObjectKey: objectLoadKey,
                },
              },
            };
          });
          if (!revalidateCached) return;
        }
      } catch (e) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: Collection MetaStore miss or error", e);
      }

      if (!isMetadataRequestCurrent(request)) return;
      try {
        const collections = await schemaService.getCollections(
          connectionId,
          namespace || "",
        );
        const currentSchema = get().currentSchema;
        if (
          !isMetadataRequestCurrent(request) ||
          currentSchema !== namespace ||
          get().collectionLoadingKey !== objectLoadKey
        ) {
          return;
        }
        set((state) => {
          const objectKey = getObjectSnapshotKey(
            connectionId,
            activeDriver,
            namespace || "",
          );
          const existingSnapshot = state.objectSnapshots[objectKey];

          return {
            collections,
            isCollectionsLoading: false,
            collectionLoadingKey: null,
            lastLoadedObjectKey: objectLoadKey,
            metadataVersion: state.metadataVersion + 1,
            objectSnapshots: {
              ...state.objectSnapshots,
              [objectKey]: {
                tables:
                  existingSnapshot?.tables ??
                  ((state.currentSchema || "") === namespace
                    ? state.tables
                    : []),
                collections,
                functions:
                  existingSnapshot?.functions ??
                  ((state.currentSchema || "") === namespace
                    ? state.functions
                    : []),
                pinnedTables:
                  existingSnapshot?.pinnedTables ??
                  ((state.currentSchema || "") === namespace
                    ? state.pinnedTables
                    : []),
                selectedTable:
                  existingSnapshot?.selectedTable ??
                  ((state.currentSchema || "") === namespace
                    ? state.selectedTable
                    : null),
                lastLoadedObjectKey: objectLoadKey,
              },
            },
          };
        });

        const newResources: Resource[] = collections.map((collection) => ({
          id: `${schemaResourceId}:${collection.name}`,
          connection_id: connectionId,
          parent_id: schemaResourceId,
          kind: "COLLECTION",
          name: collection.name,
          metadata: {
            driver: activeDriver,
            namespace: collection.namespace ?? (namespace || null),
            type: collection.type ?? null,
            documentCount: collection.documentCount ?? null,
          },
          last_updated: Date.now(),
        }));

        try {
          if (!isMetadataRequestCurrent(request)) return;
          await storeService.replaceResources(
            connectionId,
            schemaResourceId,
            "COLLECTION",
            newResources,
            request.projectId,
          );
          if (!isMetadataRequestCurrent(request)) return;
          await storeService.saveResources(
            [
              createCacheMarker(
                connectionId,
                schemaResourceId,
                COLLECTION_CACHE_KIND,
                activeDriver,
              ),
            ],
            request.projectId,
          );
        } catch (err) {
          if (!isMetadataRequestCurrent(request)) return;
          console.warn("Store: Failed to cache collections to MetaStore", err);
        }
      } catch (e) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: loadCollections failed", e);
        const currentSchema = get().currentSchema;
        if (currentSchema !== namespace) {
          return;
        }
        // A failed background revalidation must not discard a usable cached
        // collection list. The next expansion or explicit refresh can retry.
        set((state) =>
          state.collectionLoadingKey === objectLoadKey
            ? { collectionLoadingKey: null, isCollectionsLoading: false }
            : {},
        );
      }
    },

    loadMoreCollections: async (connectionId: string, namespace: string) => {
      const request = captureMetadataRequest(connectionId);
      if (!isMetadataRequestCurrent(request)) return;
      const { collectionNextCursor, collectionFilter, isCollectionsLoading } =
        get();
      if (!collectionNextCursor || isCollectionsLoading) return;
      const activeDriver = getConnectionDriver(connectionId);
      if (activeDriver !== "redis") return;

      set({ isCollectionsLoading: true });
      try {
        const page = await schemaService.getCollectionsPage(
          connectionId,
          namespace || "",
          collectionNextCursor,
          REDIS_KEY_PAGE_SIZE,
          collectionFilter || null,
        );
        if (!isMetadataRequestCurrent(request)) return;
        if (
          get().collectionLoadingKey !== null ||
          get().collectionFilter !== collectionFilter ||
          get().currentSchema !== namespace
        ) {
          return;
        }
        set((state) => {
          const byName = new Map(
            state.collections.map((collection) => [
              collection.name,
              collection,
            ]),
          );
          page.items.forEach((collection) =>
            byName.set(collection.name, collection),
          );
          const collections = Array.from(byName.values());
          return {
            collections:
              collections.length > MAX_REDIS_KEYS_IN_MEMORY
                ? collections.slice(-MAX_REDIS_KEYS_IN_MEMORY)
                : collections,
            collectionNextCursor: page.nextCursor || null,
            collectionTotal: page.total ?? state.collectionTotal,
            isCollectionsLoading: false,
          };
        });
      } catch (error) {
        if (!isMetadataRequestCurrent(request)) return;
        console.warn("Store: Failed to load more Redis keys", error);
        set({ isCollectionsLoading: false });
      }
    },
  };
};
