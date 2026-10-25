import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  EXACT_GENERATED_COLUMN_METADATA_DRIVERS,
  LSP_METADATA_CACHE_TTL_MS,
} from "@/features/lsp-sync/model/syncPolicy";
import type { CachedLspTableDefinition } from "@/features/lsp-sync/model/syncTypes";
import { getCachedLspMetadata } from "@/services/lsp/metadataCache";
import {
  assignLspObjectSourceLocations,
  classifyLspColumnOwnership,
  emptyLspTableDetails,
  type LspTableDefinition,
} from "@/services/lsp/schemaConfig";
import type { LspCatalogTarget } from "@/services/lsp/syncPlan";
import { lspCatalogKey } from "@/services/lsp/syncPlan";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { schemaService } from "@/services/tauri";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";

interface LspTableLoaderOptions {
  objectSourceUri: (
    catalog: LspCatalogTarget,
    objectName?: string | null | undefined,
    objectType?: string | null | undefined,
    columnName?: string | null | undefined,
  ) => string;
  capabilitiesPromise: Promise<DatabaseCapabilities>;
  connection: ConnectionConfig;
  activeConnectionId: string;
  syncGenerationRef: React.RefObject<number>;
  syncGeneration: number;
  metadataStats: {
    cacheHits: number;
    cacheMisses: number;
    failedObjects: number;
  };
  tableMetadataCacheRef: React.RefObject<Map<string, CachedLspTableDefinition>>;
  recordMetadataCacheStatus: (status: "hit" | "miss") => void;
  forceMetadata?: boolean;
}

export function createLspTableLoader({
  objectSourceUri,
  capabilitiesPromise,
  connection,
  activeConnectionId,
  syncGenerationRef,
  syncGeneration,
  metadataStats,
  tableMetadataCacheRef,
  recordMetadataCacheStatus,
  forceMetadata = false,
}: LspTableLoaderOptions) {
  const assignSourceLocations = (
    catalog: LspCatalogTarget,
    definition: LspTableDefinition,
  ) =>
    assignLspObjectSourceLocations(definition, {
      tableUri: objectSourceUri(
        catalog,
        definition.name,
        definition.object_type,
      ),
      columnUri: (columnName) =>
        objectSourceUri(
          catalog,
          definition.name,
          definition.object_type,
          columnName,
        ),
    });

  const buildTableDefinition = async (
    catalog: LspCatalogTarget,
    table: { name: string; type?: string | null; comment?: string | null },
  ): Promise<LspTableDefinition> => {
    try {
      const capabilities = await capabilitiesPromise;
      const hasGeneratedColumnFallback =
        EXACT_GENERATED_COLUMN_METADATA_DRIVERS.has(connection.driver);
      const metadata = await loadTableMetadata({
        connectionId: activeConnectionId,
        driver: connection.driver,
        databaseName: catalog.databaseName || undefined,
        schema: catalog.schemaName,
        table: table.name,
        includeIndexes: capabilities.supportsTableIndexes,
        includeConstraints: capabilities.supportsTableConstraints,
        priority: "background",
        force: forceMetadata,
      });
      const { columns, indexes, constraints } = metadata;
      // New metadata makes the extra catalog query unnecessary. Keep the
      // exact legacy route only while an older bundled driver omits flags.
      const needsGeneratedColumnFallback =
        hasGeneratedColumnFallback &&
        columns.some((column) => typeof column.is_generated !== "boolean");
      const generatedColumnNames = needsGeneratedColumnFallback
        ? await (
            catalog.databaseName
              ? schemaService.getDatabaseGeneratedColumns(
                  activeConnectionId,
                  catalog.databaseName,
                  catalog.schemaName,
                  table.name,
                )
              : schemaService.getGeneratedColumns(
                  activeConnectionId,
                  catalog.schemaName,
                  table.name,
                )
          ).catch((error) => {
            console.warn(
              `[LSP] Failed to classify generated columns for ${[
                catalog.catalogName,
                catalog.schemaName,
                table.name,
              ]
                .filter(Boolean)
                .join(".")}:`,
              error,
            );
            return null;
          })
        : [];
      const generatedColumns = new Set(generatedColumnNames ?? []);

      return assignSourceLocations(catalog, {
        name: table.name,
        object_type: table.type || null,
        comment: table.comment || null,
        ...emptyLspTableDetails([
          objectSourceUri(catalog, table.name, table.type || null),
          1,
        ]),
        indexes: indexes.map((index) => ({
          name: index.name,
          columns: index.columns || [],
          is_unique: index.is_unique,
          is_primary: index.is_primary,
          index_type: index.index_type || null,
          definition: index.definition || null,
        })),
        constraints: constraints.map((constraint) => ({
          name: constraint.name,
          constraint_type: constraint.constraint_type,
          columns: constraint.columns || [],
          referenced_schema: constraint.referenced_schema || null,
          referenced_table: constraint.referenced_table || null,
          referenced_columns: constraint.referenced_columns || [],
          definition: constraint.definition || null,
        })),
        columns: columns.map((col) => ({
          name: col.name,
          data_type: col.data_type || "VARCHAR",
          nullable: col.is_nullable,
          primary_key: !!col.is_primary_key,
          unique: !!col.is_unique,
          indexed: !!col.is_indexed,
          default_value: col.default_value ?? null,
          auto_increment: !!col.is_auto_increment,
          // New native/external drivers provide structured flags directly.
          // For the three legacy native paths, retain the exact discovery
          // fallback. An old external package with no classification is not
          // silently treated as writable: generated=true suppresses INSERT
          // snippets while SELECT completion remains available.
          ...classifyLspColumnOwnership(col, {
            hasExactGeneratedColumnFallback: hasGeneratedColumnFallback,
            generatedColumnNames:
              generatedColumnNames === null ? null : generatedColumns,
          }),
          comment: col.comment || null,
          source_location: [
            objectSourceUri(catalog, table.name, table.type || null, col.name),
            1,
          ],
        })),
      });
    } catch (error) {
      if (syncGenerationRef.current === syncGeneration) {
        metadataStats.failedObjects += 1;
      }
      console.error(
        `[LSP] Failed to fetch metadata for ${[
          catalog.catalogName,
          catalog.schemaName,
          table.name,
        ]
          .filter(Boolean)
          .join(".")}:`,
        error,
      );
      return assignSourceLocations(catalog, {
        name: table.name,
        object_type: table.type || null,
        comment: table.comment || null,
        ...emptyLspTableDetails([
          objectSourceUri(catalog, table.name, table.type || null),
          1,
        ]),
        columns: [],
      });
    }
  };

  const getCachedTableDefinition = (
    catalog: LspCatalogTarget,
    table: { name: string; type?: string | null; comment?: string | null },
  ) => {
    const cacheKey = `${activeConnectionId}:${connection.driver}:${lspCatalogKey(
      catalog,
    )}:${table.name}`;
    return getCachedLspMetadata(
      tableMetadataCacheRef.current,
      cacheKey,
      LSP_METADATA_CACHE_TTL_MS,
      () => buildTableDefinition(catalog, table),
      undefined,
      recordMetadataCacheStatus,
    );
  };

  return { assignSourceLocations, getCachedTableDefinition };
}
