import type { SchemaState } from "@/features/schema-metadata/model/types";
import { createBackgroundSearchSlice } from "@/features/schema-metadata/state/backgroundSearchSlice";
import { createCacheHydrationSlice } from "@/features/schema-metadata/state/cacheHydrationSlice";
import { createCacheInvalidationSlice } from "@/features/schema-metadata/state/cacheInvalidationSlice";
import { createCollectionLoadingSlice } from "@/features/schema-metadata/state/collectionLoadingSlice";
import { createLifecycleSlice } from "@/features/schema-metadata/state/lifecycleSlice";
import { createNamespaceLoadingSlice } from "@/features/schema-metadata/state/namespaceLoadingSlice";
import { createNamespaceSelectionSlice } from "@/features/schema-metadata/state/namespaceSelectionSlice";
import { createRoutineLoadingSlice } from "@/features/schema-metadata/state/routineLoadingSlice";
import { createTableLoadingSlice } from "@/features/schema-metadata/state/tableLoadingSlice";
import { create } from "zustand";
import {
  createMetadataRuntime,
  type MetadataPorts,
} from "../runtime/metadataRequests";
export function createSchemaStore(ports: MetadataPorts) {
  const runtime = createMetadataRuntime(ports);
  return create<SchemaState>((set, get) => ({
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
    defaultSchema: null,
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
    ...createLifecycleSlice(set, get, runtime),
    ...createCacheHydrationSlice(set, get, runtime),
    ...createBackgroundSearchSlice(set, get, runtime),
    ...createCacheInvalidationSlice(set, get, runtime),
    ...createNamespaceLoadingSlice(set, get, runtime),
    ...createTableLoadingSlice(set, get, runtime),
    ...createRoutineLoadingSlice(set, get, runtime),
    ...createCollectionLoadingSlice(set, get, runtime),
    ...createNamespaceSelectionSlice(set, get, runtime),
  }));
}
