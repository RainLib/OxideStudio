import type {
  ConnectionMetadataSnapshot,
  MetadataNodeState,
} from "@/features/schema-metadata/model/types";
import {
  getConnectionMetadataNodeKey,
  getConnectionMetadataSnapshotKey,
} from "@/store/useSchemaStore";
interface CreateExplorerConnectionMetadataLookupContext {
  activeConnectionId: string | null;
  connectionSnapshots: Record<string, ConnectionMetadataSnapshot>;
  schemas: string[];
  currentSchema: string | null;
  defaultSchema: string | null;
  selectedTable: string | null;
  isLoading: boolean;
  metadataNodeStates: Record<string, MetadataNodeState>;
}
export function createExplorerConnectionMetadataLookup({
  activeConnectionId,
  connectionSnapshots,
  schemas,
  currentSchema,
  defaultSchema,
  selectedTable,
  isLoading,
  metadataNodeStates,
}: CreateExplorerConnectionMetadataLookupContext) {
  const metadataForConnection = (
    connectionId: string,
    driver?: string | null,
  ) => {
    const isActiveConnection = connectionId === activeConnectionId;
    const snapshot =
      connectionSnapshots[
        getConnectionMetadataSnapshotKey(connectionId, driver)
      ];

    return {
      isActiveConnection,
      schemas: isActiveConnection ? schemas : (snapshot?.schemas ?? []),
      currentSchema: isActiveConnection
        ? currentSchema
        : (snapshot?.currentSchema ?? null),
      defaultSchema: isActiveConnection
        ? defaultSchema
        : (snapshot?.defaultSchema ?? null),
      selectedTable: isActiveConnection
        ? selectedTable
        : (snapshot?.selectedTable ?? null),
      isLoading: isActiveConnection ? isLoading : false,
      nodeState:
        metadataNodeStates[getConnectionMetadataNodeKey(connectionId, driver)],
    };
  };
  return { metadataForConnection };
}
