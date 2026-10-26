import type { DatabaseCapabilities } from "@/services/tauri/types";

/** Loading or failed enterprise negotiation must never inherit local writes. */
export function managedCapabilitiesFallback(base: DatabaseCapabilities): DatabaseCapabilities {
  return { ...base, supportsTableRowMutation:false, supportsTableDdl:false, supportsColumnAlteration:false,
    supportsTableDataTransfer:false, supportsIndexRename:false, supportsConstraintAlteration:false,
    supportsCreateDatabase:false, supportsRenameDatabase:false, supportsViews:false, supportsReplaceView:false,
    supportsMaterializedViews:false, supportsTableIndexes:false, supportsTableConstraints:false,
    supportsForeignKeys:false, supportsCheckConstraints:false, supportsFunctions:false, supportsTransactions:false,
    supportsQueryCancellation:false, supportsExplainPlan:false, supportsColumnComments:false, tableExportFormats:[], fileQueryFormats:[],
  };
}
