import type { DatabaseDriver } from "@/services/tauri/types";
import type { LspSchemaDefinition } from "../schemaConfig";

export type LspSyncConnection = {
  id: string;
  driver: DatabaseDriver;
  database?: string | null;
  /** The installed/pinned package declares server catalog selection. */
  supportsDatabaseCatalogs?: boolean;
};

export type LspSyncTab = {
  id: string;
  type: string;
  connectionId?: string | null;
  databaseName?: string | null;
  targetSchema?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  sql?: string | null;
};

export type LspCatalogTarget = {
  /** The catalog name used for identity and completion provenance. */
  catalogName: string | null;
  /** A selected server database requiring database-scoped metadata commands. */
  databaseName: string | null;
  schemaName: string;
};

export type LspSyncPlan = {
  defaultSchema: string;
  defaultCatalog: LspCatalogTarget;
  connectionTabs: LspSyncTab[];
  queryTabs: LspSyncTab[];
  targetSchemas: string[];
  targetCatalogs: LspCatalogTarget[];
  preferredTablesBySchema: Map<string, Set<string>>;
  preferredTablesByCatalog: Map<string, Set<string>>;
  schemaByTabId: Record<string, string>;
  catalogByTabId: Record<string, LspCatalogTarget>;
};

export type LspFileMappings = {
  fileSchemas: Record<string, string>;
  fileDialects: Record<string, string>;
};

export type LspCompletionPreferences = {
  keywordCase: "upper" | "lower" | "preserve";
  functionCase: "upper" | "lower" | "preserve";
  tableAlias: "none" | "initials";
};

export type LspFormattingPreferences = {
  keywordCase: "upper" | "lower" | "preserve";
  functionCase: "upper" | "lower" | "preserve";
  logicalOperatorNewline: "before" | "after" | "none";
  fromClauseLayout: "newLine" | "sameLine";
};

export type LspConfigKeyInput = LspFileMappings & {
  connectionId: string;
  driver: DatabaseDriver;
  lspDialect: string;
  completionPreferences?: LspCompletionPreferences;
  formattingPreferences?: LspFormattingPreferences;
  schemaDefinitions: LspSchemaDefinition[];
};
