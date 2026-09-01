import { saveProjectFileTab } from "@/lib/projectFileTabs";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";

export async function saveEditorFileTab(tabId?: string | null): Promise<boolean> {
  const state = useTabStore.getState();
  const resolvedTabId = tabId || state.activeTabId;
  if (!resolvedTabId) return false;
  const tab = state.tabs.find((candidate) => candidate.id === resolvedTabId);
  if (!tab) return false;
  if (!tab.savedSqlFileId) return saveProjectFileTab(resolvedTabId);
  try {
    const library = useSavedQueryStore.getState();
    if (library.projectId !== tab.savedSqlProjectId) {
      throw new Error("open the SQL Library project before saving this tab");
    }
    const saved = await library.updateQuery(tab.savedSqlFileId, tab.title, tab.sql, {
      connectionId: tab.connectionId || null,
      databaseName: tab.databaseName || null,
      schemaName: tab.schemaName || null,
    });
    if (!saved) throw new Error("the SQL Library item no longer exists");
    useTabStore.setState((current) => ({
      tabs: current.tabs.map((candidate) =>
        candidate.id === resolvedTabId
          ? { ...candidate, isDirty: false, fileError: null }
          : candidate,
      ),
    }));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useTabStore.setState((current) => ({
      tabs: current.tabs.map((candidate) =>
        candidate.id === resolvedTabId
          ? {
              ...candidate,
              fileError: `Failed to save SQL Library item: ${message}`,
            }
          : candidate,
      ),
    }));
    return false;
  }
}
