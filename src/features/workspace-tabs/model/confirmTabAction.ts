import { confirmDiscardTabChanges, hasUnsavedTabChanges } from "./tabLifecycle";
import type { TabData } from "./types";

/** Keep the clean path synchronous; a pending dialog must not authorize later edits. */
export function runAfterDiscardConfirmation(
  tabs: TabData[],
  action: string,
  currentTabs: () => TabData[],
  apply: () => void,
): Promise<void> {
  if (!tabs.some(hasUnsavedTabChanges)) { apply(); return Promise.resolve(); }
  const reviewed = tabs.map((tab) => ({
    id: tab.id, sql: tab.sql, pendingEdits: tab.pendingEdits,
    newRowsCount: tab.newRowsCount, isPinned: tab.isPinned,
    fileProjectId: tab.fileProjectId, fileRelativePath: tab.fileRelativePath,
    connectionId: tab.connectionId, schemaName: tab.schemaName, tableName: tab.tableName,
  }));
  return confirmDiscardTabChanges(tabs, action).then((approved) => {
    if (!approved) return;
    const current = currentTabs();
    if (current.length !== reviewed.length || !reviewed.every((snapshot) => {
      const tab = current.find((candidate) => candidate.id === snapshot.id);
      return tab && Object.entries(snapshot).every(([key, value]) => tab[key as keyof TabData] === value);
    })) return;
    apply();
  });
}

export async function confirmCurrentTabChanges(currentTabs: () => TabData[], action: string): Promise<boolean> {
  let approved = false;
  await runAfterDiscardConfirmation(currentTabs(), action, currentTabs, () => { approved = true; });
  return approved;
}
