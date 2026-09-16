import { normalizeDatabaseDriverName } from "./runtimeCatalog";
import type {
  DatabaseDriver,
  DatabaseDriverInstallation,
} from "@/services/tauri/types";

function canonicalDriver(driver: DatabaseDriver | string) {
  return normalizeDatabaseDriverName(driver) || String(driver).trim().toLowerCase();
}

/**
 * Mirrors the Host's package resolver for UI decisions that must never show a
 * bundled-driver SQL preview while an external package owns the connection.
 * A version pin takes precedence; otherwise only a ready active package can
 * replace the bundled implementation.
 */
export function connectionUsesExternalDriverPackage(
  driver: DatabaseDriver | string,
  packageVersion: string | null | undefined,
  installations: readonly DatabaseDriverInstallation[],
) {
  const canonical = canonicalDriver(driver);
  const pinnedVersion = packageVersion?.trim();
  return installations.some(
    (installation) =>
      installation.distribution === "external" &&
      installation.status === "ready" &&
      installation.runtimeReady !== false &&
      canonicalDriver(installation.driver) === canonical &&
      (pinnedVersion
        ? installation.packageVersion === pinnedVersion
        : installation.active),
  );
}
