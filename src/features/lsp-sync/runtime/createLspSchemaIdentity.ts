import type { ConnectionConfig } from "@/features/connections/model/types";
import { getLspDatabaseObjectUri } from "@/services/lsp/objectUri";
import { type LspCatalogTarget } from "@/services/lsp/syncPlan";
import { v4 as uuidv4 } from "uuid";

interface LspSchemaIdentityOptions {
  activeConnectionId: string;
  connection: ConnectionConfig;
}

export function createLspSchemaIdentity({
  activeConnectionId,
  connection,
}: LspSchemaIdentityOptions) {
  const getSchemaId = (
    schemaName: string,
    catalogName: string | null = null,
  ) => {
    const schemaKey = `oxide-lsp-schema-id:v2:${encodeURIComponent(
      JSON.stringify([
        activeConnectionId,
        connection.driver,
        catalogName || "",
        schemaName,
      ]),
    )}`;
    let schemaId = localStorage.getItem(schemaKey);
    if (!schemaId) {
      schemaId = uuidv4();
      localStorage.setItem(schemaKey, schemaId);
    }
    return schemaId;
  };

  const objectSourceUri = (
    catalog: LspCatalogTarget,
    objectName?: string | null,
    objectType?: string | null,
    columnName?: string | null,
  ) =>
    getLspDatabaseObjectUri({
      connectionId: activeConnectionId,
      databaseName: catalog.databaseName,
      schemaName: catalog.schemaName,
      objectName,
      objectType,
      columnName,
    });

  return { getSchemaId, objectSourceUri };
}
