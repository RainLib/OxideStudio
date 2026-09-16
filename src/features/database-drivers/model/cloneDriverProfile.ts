import {
  NATIVE_FILE_BASED_DATABASE_DRIVERS,
  capabilitiesKey,
} from "@/features/database-drivers/model/driverIdentity";
import {
  type DatabaseDriverCapabilities,
  type DatabaseDriverProfile,
} from "@/features/database-drivers/model/driverProfileTypes";
import type { DatabaseCapabilities } from "@/services/tauri/types";

export function cloneCapabilities(
  capabilities: DatabaseCapabilities,
): DatabaseCapabilities {
  return {
    ...capabilities,
    dataModel: capabilities.dataModel || "relational",
    connectionMode:
      capabilities.connectionMode ??
      (NATIVE_FILE_BASED_DATABASE_DRIVERS.has(
        capabilitiesKey(capabilities.driver),
      )
        ? "file"
        : "network"),
    supportsSqlQuery: capabilities.supportsSqlQuery ?? true,
    supportsTableBrowsing: capabilities.supportsTableBrowsing ?? true,
    tableExportFormats: [...(capabilities.tableExportFormats ?? [])],
    supportsTableRowMutation: capabilities.supportsTableRowMutation ?? false,
    supportsTableDataTransfer: capabilities.supportsTableDataTransfer ?? false,
    supportsTableDdl: capabilities.supportsTableDdl ?? false,
    supportsColumnAlteration: capabilities.supportsColumnAlteration ?? false,
    supportsIndexRename: capabilities.supportsIndexRename ?? false,
    supportsConstraintAlteration:
      capabilities.supportsConstraintAlteration ?? false,
    supportsCollectionBrowsing:
      capabilities.supportsCollectionBrowsing ?? false,
    supportsKeyValueBrowsing: capabilities.supportsKeyValueBrowsing ?? false,
    supportsDatabaseCatalogs: capabilities.supportsDatabaseCatalogs ?? false,
    supportsConnectionDatabase: capabilities.supportsConnectionDatabase ?? true,
    supportsExplainPlan: capabilities.supportsExplainPlan ?? false,
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

export function cloneDriverProfile(
  profile: DatabaseDriverProfile,
): DatabaseDriverProfile {
  return {
    ...profile,
    protocolAliases: [...profile.protocolAliases],
    sslModeParamAliases: [...profile.sslModeParamAliases],
    capabilities: {
      ...profile.capabilities,
      dataModel: profile.capabilities.dataModel || "relational",
      connectionMode:
        profile.capabilities.connectionMode ??
        (NATIVE_FILE_BASED_DATABASE_DRIVERS.has(capabilitiesKey(profile.driver))
          ? "file"
          : "network"),
      supportsSqlQuery: profile.capabilities.supportsSqlQuery ?? true,
      supportsTableBrowsing: profile.capabilities.supportsTableBrowsing ?? true,
      tableExportFormats: [...(profile.capabilities.tableExportFormats ?? [])],
      supportsTableRowMutation:
        profile.capabilities.supportsTableRowMutation ?? false,
      supportsTableDataTransfer:
        profile.capabilities.supportsTableDataTransfer ?? false,
      supportsTableDdl: profile.capabilities.supportsTableDdl ?? false,
      supportsColumnAlteration:
        profile.capabilities.supportsColumnAlteration ?? false,
      supportsIndexRename: profile.capabilities.supportsIndexRename ?? false,
      supportsConstraintAlteration:
        profile.capabilities.supportsConstraintAlteration ?? false,
      supportsCollectionBrowsing:
        profile.capabilities.supportsCollectionBrowsing ?? false,
      supportsKeyValueBrowsing:
        profile.capabilities.supportsKeyValueBrowsing ?? false,
      supportsDatabaseCatalogs:
        profile.capabilities.supportsDatabaseCatalogs ?? false,
      supportsConnectionDatabase:
        profile.capabilities.supportsConnectionDatabase ?? true,
      supportsExplainPlan: profile.capabilities.supportsExplainPlan ?? false,
      commonDataTypes: [...profile.capabilities.commonDataTypes],
    },
  };
}

function profileCapabilitiesFromRuntime(
  capabilities: DatabaseCapabilities,
): DatabaseDriverCapabilities {
  const { driver: _driver, ...rest } = cloneCapabilities(capabilities);
  return rest;
}

export function withRuntimeCapabilities(
  profile: DatabaseDriverProfile,
  capabilities?: DatabaseCapabilities,
): DatabaseDriverProfile {
  if (!capabilities) return profile;

  return {
    ...profile,
    driver: capabilities.driver,
    capabilities: profileCapabilitiesFromRuntime(capabilities),
  };
}
