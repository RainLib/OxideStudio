import type { AiToolAdapters } from "@/ai/tools/types";
import { databaseService } from "@/services/tauri";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";

export function createConnectionAdapters(): Pick<
  AiToolAdapters,
  "listConnections" | "getConnectionCapabilities"
> {
  return {
    listConnections: () =>
      useConnectionStore
        .getState()
        .connections.filter((connection) => !isManagedConnection(connection))
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          driver: connection.driver,
        })),

    getConnectionCapabilities: (driver, connectionId) => {
      const connection = connectionId
        ? useConnectionStore
            .getState()
            .connections.find((candidate) => candidate.id === connectionId)
        : undefined;
      return databaseService.getDatabaseCapabilities(
        driver,
        connection?.driverPackageVersion,
      );
    },
  };
}
