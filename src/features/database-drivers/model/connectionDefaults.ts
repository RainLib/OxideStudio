import { databaseDriverProfile } from "@/features/database-drivers/model/runtimeCatalog";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";

export function defaultDatabasePort(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).capabilities.defaultPort;
}

/**
 * File-backed engines do not use host/port, SSH or TLS form controls. Keep
 * this explicit instead of inferring it from port 0: external packages may
 * legitimately use a dynamic or non-network transport without being files.
 */
export function isFileBasedDatabaseDriver(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).capabilities.connectionMode === "file";
}

export function defaultDatabaseName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultDatabase;
}

export function connectionUrlScheme(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).urlScheme;
}

export function connectionUrlTemplateForDriver(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).connectionUrlTemplate?.trim() || null;
}

export function sslModeParamName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).sslModeParamName;
}

export function sslModeParamAliases(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).sslModeParamAliases;
}

export function defaultConnectionIcon(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultIcon;
}

export function defaultConnectionAccentClassName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultAccentClassName;
}

export function defaultDatabaseCapabilities(
  driver: DatabaseDriver,
): DatabaseCapabilities {
  const capabilities = databaseDriverProfile(driver).capabilities;
  return {
    driver,
    ...capabilities,
    supportsDatabaseCatalogs: capabilities.supportsDatabaseCatalogs ?? false,
    supportsConnectionDatabase: capabilities.supportsConnectionDatabase ?? true,
    tableExportFormats: [...(capabilities.tableExportFormats ?? [])],
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}
