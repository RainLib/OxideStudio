import {
  requestDatabaseObjectReveal,
  requestDatabaseSchemaReveal,
} from "@/lib/databaseNavigation";
import { parseLspDatabaseObjectUri } from "@/services/lsp/objectUri";
import { parseLspProjectDocumentUri } from "@/services/lsp/document";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";

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

/** Open a saved project SQL definition, but only for the active project. */
export async function revealLspProjectDefinition(
  uri: string,
  activeProjectId: string,
): Promise<boolean> {
  const target = parseLspProjectDocumentUri(uri);
  if (!target || target.projectId !== activeProjectId) return false;
  await openProjectFileInEditor(target.relativePath);
  return true;
}
