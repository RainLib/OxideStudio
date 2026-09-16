import {
  captureLiveSchemaSnapshot,
  type SchemaSnapshotIdentity,
} from "@/services/schemaSnapshotStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";

interface CreateExplorerSchemaDiagramActionContext {
  schemaDiagramLoadingKey: string | null;
  setSchemaDiagramLoadingKey: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveConnection: (id: string) => Promise<string | null>;
  openSchemaDiagramTab: (snapshot: SchemaSnapshot) => string;
}

export function createExplorerSchemaDiagramAction({
  schemaDiagramLoadingKey,
  setSchemaDiagramLoadingKey,
  setNamespaceError,
  setActiveConnection,
  openSchemaDiagramTab,
}: CreateExplorerSchemaDiagramActionContext) {
  const handleOpenSchemaDiagram = async (
    identity: SchemaSnapshotIdentity,
    selectedRelations: readonly string[] = [],
  ) => {
    const loadingKey = [
      identity.connectionId,
      identity.databaseName || "",
      identity.schemaName,
    ].join("\u0000");
    if (schemaDiagramLoadingKey) return;
    setSchemaDiagramLoadingKey(loadingKey);
    setNamespaceError(null);
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "introspection",
      title: `Diagram ${identity.schemaName}`,
      detail: identity.databaseName || identity.connectionName,
    });
    try {
      const connectionError = await setActiveConnection(identity.connectionId);
      if (connectionError) throw new Error(connectionError);
      const snapshot = await captureLiveSchemaSnapshot(identity, {
        allowPartial: true,
      });
      const tabId = openSchemaDiagramTab(snapshot);
      if (selectedRelations.length > 0) {
        const availableRelations = new Set(
          snapshot.relations.map((relation) => relation.name),
        );
        useTabStore.getState().selectSchemaDiagramRelations(
          tabId,
          selectedRelations.filter((name) => availableRelations.has(name)),
        );
      }
      tasks.finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} relations mapped`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tasks.failTask(taskId, message);
      setNamespaceError(`Diagram capture failed: ${message}`);
    } finally {
      setSchemaDiagramLoadingKey(null);
    }
  };

  return { handleOpenSchemaDiagram };
}
