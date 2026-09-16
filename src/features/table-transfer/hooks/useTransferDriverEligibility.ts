import { supportsBoundedTableDataTransfer } from "@/features/table-transfer/model/transferPolicy";
import { databaseService } from "@/services/tauri";
import { type ConnectionConfig } from "@/store/useConnectionStore";
import { useEffect, useState } from "react";

interface TransferDriverEligibilityOptions {
  open: boolean;
  connections: ConnectionConfig[];
}

export function useTransferDriverEligibility({
  open,
  connections,
}: TransferDriverEligibilityOptions) {
  const [externalTransferConnectionIds, setExternalTransferConnectionIds] =
    useState<Set<string>>(() => new Set());

  // Built-in engines are known synchronously. For every other connection,
  // ask the package manager for its signed capability contract before putting
  // it in the target chooser. This keeps ordinary JDBC/read-only packages out
  // while allowing a reviewed native sidecar to participate without another
  // frontend allow-list release.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const externalConnections = connections.filter(
      (connection) => !supportsBoundedTableDataTransfer(connection.driver),
    );
    if (externalConnections.length === 0) {
      setExternalTransferConnectionIds(new Set());
      return;
    }
    void Promise.all(
      externalConnections.map(async (connection) => {
        try {
          const capabilities = await databaseService.getDatabaseCapabilities(
            connection.driver,
            connection.driverPackageVersion,
          );
          return capabilities.supportsTableDataTransfer === true
            ? connection.id
            : null;
        } catch {
          // A stale/inactive package must not become a write target merely
          // because its connection was retained in local state.
          return null;
        }
      }),
    ).then((connectionIds) => {
      if (!cancelled) {
        setExternalTransferConnectionIds(
          new Set(connectionIds.filter((id): id is string => id !== null)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connections, open]);

  return { externalTransferConnectionIds };
}
