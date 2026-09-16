import {
  type DatabaseDriver,
  type DatabaseDriverCatalogEntry,
} from "@/services/tauri";
import { type ConnectionConfig } from "@/store/useConnectionStore";

export function signedCatalogReleaseForDriver(
  entries: DatabaseDriverCatalogEntry[],
  driver: DatabaseDriver,
) {
  return (
    entries.find(
      (entry) =>
        entry.driverId.toLowerCase() === driver.toLowerCase() &&
        Boolean(entry.archiveSha256),
    ) || null
  );
}

export function normalizeSignedCatalogUrl(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function uniqueConnections(
  connections: ConnectionConfig[],
  selectedConnection: ConnectionConfig | null,
) {
  if (!selectedConnection) return connections;
  if (connections.some((item) => item.id === selectedConnection.id)) {
    return connections.map((item) =>
      item.id === selectedConnection.id ? selectedConnection : item,
    );
  }
  return [selectedConnection, ...connections];
}

export const ACTIVE_DRIVER_PACKAGE_VALUE = "__oxide_active_driver_package__";
