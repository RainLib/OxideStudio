import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";

export async function saveProjectFileTab(tabId?: string | null) {
  const tabStore = useTabStore.getState();
  const resolvedTabId = tabId || tabStore.activeTabId;
  const tab = tabStore.tabs.find((candidate) => candidate.id === resolvedTabId);
  if (!tab?.fileRelativePath || !tab.fileProjectId) return false;

  const files = useProjectFilesStore.getState();
  files.syncActiveProject();
  const activeFiles = useProjectFilesStore.getState();
  if (
    activeFiles.projectId !== tab.fileProjectId ||
    (tab.fileRootPath && activeFiles.rootPath !== tab.fileRootPath)
  ) {
    const message =
      "The project directory changed after this file was opened. Reopen the file from the Files panel before saving.";
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === tab.id
          ? { ...candidate, fileError: `Failed to save file: ${message}` }
          : candidate
      ),
    }));
    return false;
  }

  try {
    const submittedContent = tab.sql;
    const document = await activeFiles.writeFile(
      tab.fileRelativePath,
      submittedContent,
      tab.fileRevision
    );
    useTabStore
      .getState()
      .markProjectFileSaved(tab.id, document.revision, submittedContent);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === tab.id
          ? { ...candidate, fileError: `Failed to save file: ${message}` }
          : candidate
      ),
    }));
    return false;
  }
}
