import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore, type TabData } from "@/store/useTabStore";
import type { UiActionContextSnapshot } from "./types";

let contextVersion = 0;
let lastContextSignature = "";

export function captureWorkspaceUiActionContext(): UiActionContextSnapshot {
  const project = useProjectStore.getState();
  const connection = useConnectionStore.getState();
  const schema = useSchemaStore.getState();
  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
  const documentRevision = activeTab ? documentRevisionForTabData(activeTab) : null;
  const signature = JSON.stringify([
    project.activeProjectId,
    connection.activeConnectionId,
    schema.currentSchema,
    tabState.activeTabId,
    documentRevision,
  ]);

  if (signature !== lastContextSignature) {
    lastContextSignature = signature;
    contextVersion += 1;
  }

  return {
    projectId: project.activeProjectId,
    contextVersion,
    activeConnectionId: connection.activeConnectionId,
    activeNamespace: schema.currentSchema,
    activeTabId: tabState.activeTabId,
    documentRevision,
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
  const sourceRevision = tab.fileRevision || "memory";
  return `${sourceRevision}:${hashText(tab.sql)}`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
