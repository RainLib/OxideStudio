import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types";

export function canConfigureUnquotedTransferTargetColumns(
  driver: DatabaseDriver | string | null | undefined,
  distribution: "bundled" | "external" | "managed" | null,
  capabilities: DatabaseCapabilities | null,
): boolean {
  const normalizedDriver = driver?.trim().toLocaleLowerCase();
  return (
    distribution === "external" &&
    capabilities?.supportsTableDataTransfer === true &&
    (normalizedDriver === "gaussdb" || normalizedDriver === "opengauss")
  );
}
