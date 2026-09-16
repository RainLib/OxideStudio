import { supportsLspCapabilities } from "@/features/database-drivers/model/lspRouting";
import type { DatabaseCapabilities } from "@/services/tauri/types";

export function isRelationalDataModel(
  capabilities: Pick<DatabaseCapabilities, "dataModel">,
) {
  return capabilities.dataModel === "relational";
}

export function supportsSqlWorkspace(
  capabilities: Pick<DatabaseCapabilities, "supportsSqlQuery">,
) {
  return capabilities.supportsSqlQuery;
}

export function supportsTableWorkspace(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "supportsTableBrowsing"
  >,
) {
  return (
    isRelationalDataModel(capabilities) && capabilities.supportsTableBrowsing
  );
}

/**
 * Metadata made available to SQL completion is deliberately broader than the
 * editable Data Grid. A signed SQL-shaped time-series package may expose
 * relation-like measurements and columns for completion without being a
 * relational table editor. The package must opt into both table browsing and
 * a supported SQL LSP route; a generic non-relational package cannot acquire
 * catalog metadata merely by returning table-shaped data.
 */
export function supportsSqlRelationMetadataLsp(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "lspLanguageId" | "supportsSqlQuery" | "supportsTableBrowsing"
  >,
) {
  return (
    capabilities.supportsTableBrowsing && supportsLspCapabilities(capabilities)
  );
}
