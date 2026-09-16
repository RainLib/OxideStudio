import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useMemo } from "react";

export function useExplorerWorkspaceData() {
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const connections = useConnectionStore((state) => state.connections);
  const connectionDisplayCache = useConnectionStore(
    (state) => state.connectionDisplayCache,
  );
  const hasConnectionDisplayCache = useConnectionStore(
    (state) => state.hasConnectionDisplayCache,
  );
  const connectionsLoading = useConnectionStore((state) => state.isLoading);
  const queryHistory = useHistoryStore((state) => state.history);
  const connectionLoadError = useConnectionStore((state) => state.loadError);
  const loadConnections = useConnectionStore((state) => state.loadConnections);
  const connectedConnectionIds = useConnectionStore(
    (state) => state.connectedConnectionIds,
  );
  const connectionRuntimeStates = useConnectionStore(
    (state) => state.connectionRuntimeStates,
  );
  const setActiveConnection = useConnectionStore(
    (state) => state.setActiveConnection,
  );
  const createNewConnection = useConnectionStore(
    (state) => state.createNewConnection,
  );
  const updateConnectionConfig = useConnectionStore(
    (state) => state.updateConnectionConfig,
  );
  const selectConnection = useConnectionStore(
    (state) => state.selectConnection,
  );
  const removeConnection = useConnectionStore(
    (state) => state.removeConnection,
  );
  const disconnect = useConnectionStore((state) => state.disconnect);
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (store) => store.setToolWindowVisible,
  );
  const { activeProjectId } = useProjectStore();
  const {
    isLoading,
    schemas,
    currentSchema,
    defaultSchema,
    loadSchemas,
    loadTables,
    loadCollections,
    loadMoreCollections,
    loadFunctions,
    tables,
    collections,
    functions,
    pinnedTables,
    connectionSnapshots,
    objectSnapshots,
    hydrateConnectionMetadataFromCache,
    hydrateSchemaObjectsFromCache,
    loadSchemaObjectsForSearch,
    forgetConnectionMetadata,
    forgetSchemaMetadata,
    togglePinTable,
    setCurrentSchema,
    selectTable,
    selectedTable,
    bumpMetadataVersion,
    isCollectionsLoading,
    collectionNextCursor,
    collectionTotal,
    isFunctionsLoading,
    metadataNodeStates,
    metadataVersion,
  } = useSchemaStore();

  const connectionAvailabilityKey = useMemo(
    () => connections.map((connection) => connection.id).join("|"),
    [connections],
  );

  return {
    activeConnectionId,
    connections,
    connectionDisplayCache,
    hasConnectionDisplayCache,
    connectionsLoading,
    queryHistory,
    connectionLoadError,
    loadConnections,
    connectedConnectionIds,
    connectionRuntimeStates,
    setActiveConnection,
    createNewConnection,
    updateConnectionConfig,
    selectConnection,
    removeConnection,
    disconnect,
    setToolWindowVisible,
    activeProjectId,
    isLoading,
    schemas,
    currentSchema,
    defaultSchema,
    loadSchemas,
    loadTables,
    loadCollections,
    loadMoreCollections,
    loadFunctions,
    tables,
    collections,
    functions,
    pinnedTables,
    connectionSnapshots,
    objectSnapshots,
    hydrateConnectionMetadataFromCache,
    hydrateSchemaObjectsFromCache,
    loadSchemaObjectsForSearch,
    forgetConnectionMetadata,
    forgetSchemaMetadata,
    togglePinTable,
    setCurrentSchema,
    selectTable,
    selectedTable,
    bumpMetadataVersion,
    isCollectionsLoading,
    collectionNextCursor,
    collectionTotal,
    isFunctionsLoading,
    metadataNodeStates,
    metadataVersion,
    connectionAvailabilityKey,
  };
}
