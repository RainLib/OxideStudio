import { schemaService } from "@/services/tauri";
import { lspCatalogKey, type LspCatalogTarget } from "@/services/lsp/syncPlan";
import type { SqlLookupContext } from "@/services/tauri/schema/catalog";
const requestDatabase = (catalog: LspCatalogTarget) => catalog.databaseName || catalog.catalogName || null;
const validName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);

/** Only a driver-confirmed single-default SQL Server context can populate
 * namespace metadata. Table absence remains unproven by this v1 contract. */
export async function loadSqlLookupContexts(options: {
  connectionId: string;
  dialect: string;
  targetCatalogs: LspCatalogTarget[];
  preferredTablesByCatalog: Map<string, Set<string>>;
}) {
  const byRequest = new Map<string | null, SqlLookupContext>();
  const byDatabase = new Map<string, SqlLookupContext>();
  const conflicting = new Set<string>();
  let failures = 0;
  if (["sqlserver", "mssql", "tsql"].includes(options.dialect)) {
    const requests = [...new Set(options.targetCatalogs.map(requestDatabase))];
    await Promise.all(requests.map(async database => {
      try {
        const context = await schemaService.getSqlLookupContext(options.connectionId, database);
        if (context === null) return;
        if (!context || !validName(context.database) || !validName(context.defaultSchema) || database !== null && context.database !== database) {
          failures++;
          return;
        }
        const previous = byDatabase.get(context.database);
        if (previous && previous.defaultSchema !== context.defaultSchema) conflicting.add(context.database);
        byDatabase.set(context.database, context);
        byRequest.set(database, context);
      } catch (error) {
        failures++;
        console.warn("[LSP] Effective SQL lookup context is unavailable:", error);
      }
    }));
  }
  for (const database of conflicting) {
    byDatabase.delete(database);
    failures++;
  }
  const bindCatalog = (catalog: LspCatalogTarget): LspCatalogTarget => {
    const context = byRequest.get(requestDatabase(catalog));
    return context && !conflicting.has(context.database) ? {
      ...catalog,
      catalogName: context.database,
      databaseName: context.database
    } : catalog;
  };
  const catalogs = new Map<string, LspCatalogTarget>();
  const preferredTablesByCatalog = new Map<string, Set<string>>();
  for (const original of options.targetCatalogs) {
    const catalog = bindCatalog(original),
      key = lspCatalogKey(catalog);
    catalogs.set(key, catalog);
    const preferred = options.preferredTablesByCatalog.get(lspCatalogKey(original));
    if (preferred) preferredTablesByCatalog.set(key, new Set([...(preferredTablesByCatalog.get(key) || []), ...preferred]));
  }
  for (const context of byDatabase.values()) {
    const catalog = {
      catalogName: context.database,
      databaseName: context.database,
      schemaName: context.defaultSchema
    };
    const key = lspCatalogKey(catalog);
    if (!catalogs.has(key)) catalogs.set(key, catalog);
  }
  const namespaceFor = (catalog: LspCatalogTarget) => {
    const context = catalog.catalogName ? byDatabase.get(catalog.catalogName) : undefined;
    return context ? {
      default_schema: context.defaultSchema,
      tables_complete: false
    } : undefined;
  };
  return {
    targetCatalogs: [...catalogs.values()],
    preferredTablesByCatalog,
    bindCatalog,
    namespaceFor,
    failures
  };
}
