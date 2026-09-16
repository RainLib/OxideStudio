import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

/**
 * Selects the editor's workspace data and state actions in one place.
 * Editor lifecycle hooks receive these values from the controller rather than
 * coupling themselves to every global store.
 */
export function useQueryEditorWorkspaceState(tabId?: string | null) {
  const storeActiveTabId = useTabStore((state) => state.activeTabId);
  const effectiveTabId = tabId === undefined ? storeActiveTabId : tabId;
  const activeTab = useTabStore((state) =>
    state.tabs.find((candidate) => candidate.id === effectiveTabId),
  );
  const tabContextSignature = useTabStore((state) =>
    state.tabs
      .map((candidate) =>
        [candidate.id, candidate.type, candidate.connectionId || ""].join(
          "\u0001",
        ),
      )
      .join("\u0000"),
  );
  const tabContexts = useMemo(
    () =>
      useTabStore.getState().tabs.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        connectionId: candidate.connectionId,
      })),
    [tabContextSignature],
  );
  const tabActions = useTabStore(
    useShallow((state) => ({
      updateTabSql: state.updateTabSql,
      setQueryLanguage: state.setQueryLanguage,
      setElasticsearchVariables: state.setElasticsearchVariables,
      runTabQuery: state.runTabQuery,
      runExplainPlan: state.runExplainPlan,
      cancelTabQuery: state.cancelTabQuery,
      setTargetSchema: state.setTargetSchema,
      setTargetDatabase: state.setTargetDatabase,
      setEditorSelection: state.setEditorSelection,
      setEditorViewport: state.setEditorViewport,
      setLspDiagnostics: state.setLspDiagnostics,
      applyEditorPatchPreview: state.applyEditorPatchPreview,
      dismissEditorPatch: state.dismissEditorPatch,
    })),
  );
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const connections = useConnectionStore((state) => state.connections);
  const connectedConnectionIds = useConnectionStore(
    (state) => state.connectedConnectionIds,
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const schemaTables = useSchemaStore((state) => state.tables);
  const schemaCollections = useSchemaStore((state) => state.collections);
  const metadataVersion = useSchemaStore((state) => state.metadataVersion);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const loadTables = useSchemaStore((state) => state.loadTables);
  const bumpMetadataVersion = useSchemaStore(
    (state) => state.bumpMetadataVersion,
  );
  const savedQueries = useSavedQueryStore((state) => state.savedQueries);
  const saveQuery = useSavedQueryStore((state) => state.saveQuery);
  const deleteQuery = useSavedQueryStore((state) => state.deleteQuery);
  const openSavedSqlFile = useSavedQueryStore((state) => state.openFile);
  const updateSavedSqlFile = useSavedQueryStore((state) => state.updateQuery);
  const editorSettings = useSettingsStore((state) => state.settings.editor);
  const keymap = useSettingsStore((state) => state.settings.keymap);

  return {
    activeTab,
    activeConnectionId,
    activeProjectId,
    bumpMetadataVersion,
    cancelTabQuery: tabActions.cancelTabQuery,
    connectedConnectionIds,
    connections,
    currentSchema,
    deleteQuery,
    dismissEditorPatch: tabActions.dismissEditorPatch,
    editorSettings,
    effectiveTabId,
    keymap,
    loadSchemas,
    loadTables,
    metadataVersion,
    openSavedSqlFile,
    runExplainPlan: tabActions.runExplainPlan,
    runTabQuery: tabActions.runTabQuery,
    saveQuery,
    savedQueries,
    schemaCollections,
    schemaTables,
    setEditorSelection: tabActions.setEditorSelection,
    setEditorViewport: tabActions.setEditorViewport,
    setElasticsearchVariables: tabActions.setElasticsearchVariables,
    setLspDiagnostics: tabActions.setLspDiagnostics,
    setQueryLanguage: tabActions.setQueryLanguage,
    setTargetDatabase: tabActions.setTargetDatabase,
    setTargetSchema: tabActions.setTargetSchema,
    tabContexts,
    updateSavedSqlFile,
    updateTabSql: tabActions.updateTabSql,
    applyEditorPatchPreview: tabActions.applyEditorPatchPreview,
  };
}
