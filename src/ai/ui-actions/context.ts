import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore, type TabData } from "@/store/useTabStore";
import type { UiActionContextSnapshot } from "./types";
import { documentTextRevision } from "@/lib/documentRevision";

let contextVersion = 0;
let lastContextSignature = "";

export function captureWorkspaceUiActionContext(): UiActionContextSnapshot {
  const project = useProjectStore.getState();
  const connection = useConnectionStore.getState();
  const schema = useSchemaStore.getState();
  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
  const activeConnection = connection.connections.find(
    (candidate) => candidate.id === connection.activeConnectionId,
  );
  const documentRevision = activeTab ? documentRevisionForTabData(activeTab) : null;
  const selectionRevision = activeTab
    ? selectionRevisionForTabData(activeTab)
    : null;
  const activeDatabaseName =
    activeTab?.databaseName ?? activeConnection?.database ?? null;
  const signature = JSON.stringify([
    project.activeProjectId,
    connection.activeConnectionId,
    activeConnection?.driver ?? null,
    activeDatabaseName,
    schema.currentSchema,
    tabState.activeTabId,
    documentRevision,
    selectionRevision,
  ]);

  if (signature !== lastContextSignature) {
    lastContextSignature = signature;
    contextVersion += 1;
  }

  return {
    projectId: project.activeProjectId,
    contextVersion,
    activeConnectionId: connection.activeConnectionId,
    activeDriver: activeConnection?.driver ?? null,
    activeDatabaseName,
    activeNamespace: schema.currentSchema,
    activeTabId: tabState.activeTabId,
    documentRevision,
    selectionRevision,
  };
}

export function documentRevisionForTab(tabId: string) {
  const tab = useTabStore.getState().tabs.find((candidate) => candidate.id === tabId);
  return tab ? documentRevisionForTabData(tab) : null;
}

export function resetUiActionContextTracker() {
  contextVersion = 0;
  lastContextSignature = "";
}

function documentRevisionForTabData(tab: TabData) {
  return documentTextRevision(tab.fileRevision, tab.sql);
}

function selectionRevisionForTabData(tab: TabData) {
  const selection = tab.editorSelection;
  if (!selection?.text) return null;
  return JSON.stringify([
    selection.startLineNumber,
    selection.startColumn,
    selection.endLineNumber,
    selection.endColumn,
    documentTextRevision(null, selection.text),
  ]);
}
