import type { DatabaseDriver } from "@/services/tauri/types";
import { getLspDocumentUri } from "../document";
import { lspSchemaForTab, normalizeLspDatabaseName } from "./catalog";
import type { LspCatalogTarget, LspFileMappings, LspSyncTab } from "./types";

export function buildLspFileMappings(options: {
  queryTabs: LspSyncTab[];
  schemaByTabId: Record<string, string>;
  catalogByTabId?: Record<string, LspCatalogTarget>;
  defaultSchema: string;
  defaultCatalog?: LspCatalogTarget;
  driver: DatabaseDriver;
  /** Language sent in didOpen/didChange and encoded in the virtual URI. */
  documentLanguageId?: string;
  /** Concrete dialect understood by the bundled LSP server. */
  lspDialect: string;
  getSchemaId: (
    schemaName: string,
    catalogName?: string | null,
    databaseName?: string | null,
  ) => string;
}): LspFileMappings {
  const {
    queryTabs,
    schemaByTabId,
    catalogByTabId = {},
    defaultSchema,
    defaultCatalog,
    driver,
    lspDialect,
    documentLanguageId = lspDialect,
    getSchemaId,
  } = options;
  const fileSchemas = Object.fromEntries(
    queryTabs.map((tab) => {
      const tabDatabaseName = normalizeLspDatabaseName(tab.databaseName);
      const fallbackCatalog: LspCatalogTarget = defaultCatalog || {
        catalogName: tabDatabaseName,
        databaseName: tabDatabaseName,
        schemaName: defaultSchema,
      };
      const schemaName =
        schemaByTabId[tab.id] || lspSchemaForTab(tab, fallbackCatalog.schemaName);
      const catalog = catalogByTabId[tab.id] || {
        catalogName: tabDatabaseName || fallbackCatalog.catalogName,
        databaseName: tabDatabaseName,
        schemaName,
      };
      return [
        getLspDocumentUri(tab.id, driver, documentLanguageId),
        getSchemaId(schemaName, catalog.catalogName, catalog.databaseName),
      ];
    }),
  );
  const fileDialects = Object.fromEntries(
    queryTabs.map((tab) => [
      getLspDocumentUri(tab.id, driver, documentLanguageId),
      lspDialect,
    ]),
  );
  return { fileSchemas, fileDialects };
}
