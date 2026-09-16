import type { ConnectionState } from "@/features/connections/model/types";
import { getActiveProjectId } from "@/features/schema-metadata/model/metadataIdentity";
import {
  type MetadataLoadFlight,
  type MetadataRequestContext,
} from "@/features/schema-metadata/model/types";
export interface MetadataPorts {
  getConnectionState: () => Pick<
    ConnectionState,
    "activeConnectionId" | "connections"
  >;
}
export function createMetadataRuntime({ getConnectionState }: MetadataPorts) {
  const metadataRuntime = {
    generation: 0,
    namespaceSelectionGeneration: 0,
  };

  const schemaLoadsInFlight = new Map<string, MetadataLoadFlight>();

  const tableLoadsInFlight = new Map<string, MetadataLoadFlight>();

  const schemaSearchLoadsInFlight = new Map<string, Promise<boolean>>();

  const captureMetadataRequest = (
    connectionId: string,
  ): MetadataRequestContext => ({
    connectionId,
    generation: metadataRuntime.generation,
    projectId: getActiveProjectId(),
  });

  const isMetadataRequestCurrent = (request: MetadataRequestContext) =>
    request.generation === metadataRuntime.generation &&
    request.projectId === getActiveProjectId() &&
    getConnectionState().activeConnectionId === request.connectionId;

  const metadataRequestKey = (
    request: MetadataRequestContext,
    ...parts: string[]
  ) =>
    [
      request.generation,
      request.projectId,
      request.connectionId,
      ...parts,
    ].join(":");
  const getConnectionDriver = (connectionId: string) =>
    getConnectionState().connections.find(
      (connection) => connection.id === connectionId,
    )?.driver || null;
  return {
    metadataRuntime,
    schemaLoadsInFlight,
    tableLoadsInFlight,
    schemaSearchLoadsInFlight,
    captureMetadataRequest,
    isMetadataRequestCurrent,
    metadataRequestKey,
    getConnectionDriver,
    getConnectionState,
  };
}
export type MetadataRuntime = ReturnType<typeof createMetadataRuntime>;
