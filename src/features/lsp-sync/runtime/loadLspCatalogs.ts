import {
  selectLspTablesForSchema,
  type LspFunctionDefinition,
} from "@/services/lsp/schemaConfig";
import type { LspCatalogTarget } from "@/services/lsp/syncPlan";
import { lspCatalogKey } from "@/services/lsp/syncPlan";
import { schemaService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";

interface LspCatalogsOptions {
  targetCatalogs: LspCatalogTarget[];
  canSyncTableMetadata: boolean;
  activeConnectionId: string;
  canSyncCollectionMetadata: boolean;
  capabilities: DatabaseCapabilities;
  preferredTablesByCatalog: Map<string, Set<string>>;
  useOnDemandColumnMetadata: boolean;
}

export async function loadLspCatalogs({
  targetCatalogs,
  canSyncTableMetadata,
  activeConnectionId,
  canSyncCollectionMetadata,
  capabilities,
  preferredTablesByCatalog,
  useOnDemandColumnMetadata,
}: LspCatalogsOptions) {
  const catalogs = await Promise.all(
    targetCatalogs.map(async (catalog) => {
      const { databaseName, schemaName } = catalog;
      const [schemaTables, schemaCollections, schemaFunctions] =
        await Promise.all([
          canSyncTableMetadata
            ? (databaseName
                ? schemaService.getDatabaseTables(
                    activeConnectionId,
                    databaseName,
                    schemaName,
                  )
                : schemaService.getTables(activeConnectionId, schemaName)
              ).catch((error) => {
                console.error(
                  `[LSP] Failed to fetch tables for ${schemaName}:`,
                  error,
                );
                return [];
              })
            : Promise.resolve([]),
          canSyncCollectionMetadata
            ? schemaService
                .getCollections(activeConnectionId, schemaName)
                .catch((error) => {
                  console.error(
                    `[LSP] Failed to fetch objects for ${schemaName}:`,
                    error,
                  );
                  return [];
                })
            : Promise.resolve([]),
          canSyncTableMetadata && capabilities.supportsFunctions
            ? (databaseName
                ? schemaService.getDatabaseFunctions(
                    activeConnectionId,
                    databaseName,
                    schemaName,
                  )
                : schemaService.getFunctions(activeConnectionId, schemaName)
              ).catch((error) => {
                console.error(
                  `[LSP] Failed to fetch functions for ${schemaName}:`,
                  error,
                );
                return [];
              })
            : Promise.resolve([]),
        ]);
      const lspFunctions: LspFunctionDefinition[] = schemaFunctions.map(
        (func) => ({
          name: func.name,
          routine_type: func.routine_type || null,
          parameters: (func.parameters || []).map((parameter) => ({
            name: parameter.name,
            data_type: parameter.data_type || "unknown",
            optional: !!parameter.optional,
            mode: parameter.mode ?? null,
          })),
          return_type: func.return_type || "unknown",
          description: func.description || null,
        }),
      );

      const tables = selectLspTablesForSchema(
        schemaTables,
        preferredTablesByCatalog.get(lspCatalogKey(catalog)),
      );
      const preferredTables = useOnDemandColumnMetadata
        ? selectLspTablesForSchema(
            tables,
            preferredTablesByCatalog.get(lspCatalogKey(catalog)),
            preferredTablesByCatalog.get(lspCatalogKey(catalog))?.size || 0,
          )
        : tables;

      return {
        ...catalog,
        tables,
        metadataTableIndexes: preferredTables
          .map((table) => tables.indexOf(table))
          .filter((index) => index >= 0),
        collections: selectLspTablesForSchema(
          schemaCollections,
          preferredTablesByCatalog.get(lspCatalogKey(catalog)),
        ),
        functions: lspFunctions,
      };
    }),
  );

  return { catalogs };
}
