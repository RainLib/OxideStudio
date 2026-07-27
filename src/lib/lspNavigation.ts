import {
  requestDatabaseObjectReveal,
  requestDatabaseSchemaReveal,
} from "@/lib/databaseNavigation";
import { parseLspDatabaseObjectUri } from "@/services/lsp/objectUri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";

/**
 * Resolves an application-owned LSP definition URI through the same Database
 * Explorer navigation path used by assistant attachments and schema artifacts.
 */
export async function revealLspDatabaseDefinition(
  uri: string,
  projectId: string
): Promise<boolean> {
  const target = parseLspDatabaseObjectUri(uri);
  if (!target) return false;

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === target.connectionId);
  if (!connection) return false;

  if (useConnectionStore.getState().activeConnectionId !== connection.id) {
    const error = await useConnectionStore
      .getState()
      .setActiveConnection(connection.id);
    if (error) throw new Error(error);
  }

  useWorkbenchLayoutStore
    .getState()
    .setActiveToolWindow("databaseExplorer");

  if (target.objectName) {
    requestDatabaseObjectReveal({
      projectId,
      connectionId: connection.id,
      databaseName: target.databaseName || undefined,
      schemaName: target.schemaName,
      objectType: target.objectType || undefined,
      objectName: target.objectName,
    });
  } else {
    requestDatabaseSchemaReveal({
      projectId,
      connectionId: connection.id,
      databaseName: target.databaseName || undefined,
      schemaName: target.schemaName,
    });
  }
  return true;
}
