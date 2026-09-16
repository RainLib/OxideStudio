import type { ConnectionConfig } from "@/features/connections/model/types";
import type { ExplorerDataCompareRequest } from "@/features/database-explorer/model/explorerSidebarTypes";
import { supportsTableWorkspace } from "@/lib/databaseDialect";
import { databaseService, schemaService } from "@/services/tauri";

interface CreateExplorerDataCompareActionContext {
  connections: ConnectionConfig[];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveConnection: (id: string) => Promise<string | null>;
  currentSchema: string | null;
  setDataCompareRequest: React.Dispatch<
    React.SetStateAction<ExplorerDataCompareRequest | null>
  >;
}

export function createExplorerDataCompareAction({
  connections,
  setNamespaceError,
  setActiveConnection,
  currentSchema,
  setDataCompareRequest,
}: CreateExplorerDataCompareActionContext) {
  const handleOpenDataCompare = async (options: {
    connection: (typeof connections)[number];
    database?: string;
    schema?: string;
    table?: string;
    tables?: string[];
  }) => {
    setNamespaceError(null);
    try {
      const readiness = await setActiveConnection(options.connection.id);
      if (readiness) throw new Error(readiness);
      const context =
        await databaseService.getConnectionDatabaseCapabilityContext(
          options.connection.id,
        );
      if (!supportsTableWorkspace(context.capabilities)) {
        throw new Error(
          `${context.capabilities.displayName} does not expose a comparable table workspace.`,
        );
      }
      const availableSchemas = options.database
        ? await schemaService.getDatabaseSchemas(
            options.connection.id,
            options.database,
          )
        : await schemaService.getSchemas(options.connection.id);
      const schema =
        options.schema ||
        [currentSchema, "public", "dbo", availableSchemas[0]].find(
          (candidate): candidate is string =>
            Boolean(candidate && availableSchemas.includes(candidate)),
        );
      if (!schema) throw new Error("No comparable schema was found.");
      const requested = options.tables?.length
        ? options.tables
        : options.table
          ? [options.table]
          : [];
      const tableNames = requested.length
        ? requested
        : (options.database
            ? await schemaService.getDatabaseTables(
                options.connection.id,
                options.database,
                schema,
              )
            : await schemaService.getTables(options.connection.id, schema)
          )
            .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
            .map((item) => item.name);
      const sourceTables = [...new Set(tableNames)].sort((left, right) =>
        left.localeCompare(right),
      );
      if (sourceTables.length === 0) {
        throw new Error(`No comparable tables were found in ${schema}.`);
      }
      setDataCompareRequest({
        source: {
          connectionId: options.connection.id,
          driver: options.connection.driver,
          database: options.database,
          schema,
          table: sourceTables[0]!,
        },
        sourceTables,
        sourceCapabilities: context.capabilities,
      });
    } catch (nextError) {
      setNamespaceError(
        `Could not prepare data comparison: ${nextError instanceof Error ? nextError.message : String(nextError)}`,
      );
    }
  };

  return { handleOpenDataCompare };
}
