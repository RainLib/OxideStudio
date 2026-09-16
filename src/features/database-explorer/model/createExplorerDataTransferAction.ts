import type { ConnectionConfig } from "@/features/connections/model/types";
import type { ExplorerDataTransferRequest } from "@/features/database-explorer/model/explorerSidebarTypes";
import { databaseService, schemaService } from "@/services/tauri";

interface CreateExplorerDataTransferActionContext {
  connections: ConnectionConfig[];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveConnection: (id: string) => Promise<string | null>;
  currentSchema: string | null;
  setDataTransferRequest: React.Dispatch<
    React.SetStateAction<ExplorerDataTransferRequest | null>
  >;
}

export function createExplorerDataTransferAction({
  connections,
  setNamespaceError,
  setActiveConnection,
  currentSchema,
  setDataTransferRequest,
}: CreateExplorerDataTransferActionContext) {
  const handleOpenDataTransfer = async (options: {
    connection: (typeof connections)[number];
    database?: string;
    schema?: string;
    table?: string;
    tables?: string[];
    scope: "table" | "schema" | "database";
  }) => {
    const {
      connection,
      database,
      scope,
      table,
      tables: requestedTables,
    } = options;
    setNamespaceError(null);
    try {
      const connectionError = await setActiveConnection(connection.id);
      if (connectionError) throw new Error(connectionError);

      const capabilityContext =
        await databaseService.getConnectionDatabaseCapabilityContext(
          connection.id,
        );
      if (!capabilityContext.capabilities.supportsTableDataTransfer) {
        throw new Error(
          `${capabilityContext.capabilities.displayName} does not expose a verified table-data transfer contract.`,
        );
      }

      const schemas = options.schema
        ? [options.schema]
        : database
          ? await schemaService.getDatabaseSchemas(connection.id, database)
          : await schemaService.getSchemas(connection.id);
      const schema =
        options.schema ||
        [currentSchema, "public", "dbo", schemas[0]].find(
          (candidate): candidate is string =>
            Boolean(candidate && schemas.includes(candidate)),
        );
      if (!schema) {
        throw new Error("No transferable schema was found in this database.");
      }

      let sourceTable = table || requestedTables?.[0];
      if (!sourceTable) {
        const relations = database
          ? await schemaService.getDatabaseTables(
              connection.id,
              database,
              schema,
            )
          : await schemaService.getTables(connection.id, schema);
        sourceTable = relations
          .filter((relation) => !relation.type?.toUpperCase().includes("VIEW"))
          .map((relation) => relation.name)
          .sort((left, right) => left.localeCompare(right))[0];
      }
      if (!sourceTable) {
        throw new Error(
          `No transferable tables were found in ${[database, schema].filter(Boolean).join(".")}.`,
        );
      }

      setDataTransferRequest({
        source: {
          connectionId: connection.id,
          driver: connection.driver,
          database,
          schema,
          table: sourceTable,
        },
        sourceCapabilities: capabilityContext.capabilities,
        initialSourceScope: scope,
        sourceSchemas: schemas,
        initialSourceTables: requestedTables,
      });
    } catch (error) {
      setNamespaceError(
        `Could not prepare data transfer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return { handleOpenDataTransfer };
}
