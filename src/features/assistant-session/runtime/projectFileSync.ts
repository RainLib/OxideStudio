import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";

export function parentProjectPath(relativePath: string) {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

export function syncAppliedProjectFile(
  projectId: string,
  relativePath: string,
  content: string,
  revision: string,
) {
  const tabs = useTabStore.getState();
  const openTab = tabs.tabs.find(
    (tab) =>
      !tab.agentFileDiffPreview &&
      tab.fileProjectId === projectId &&
      tab.fileRelativePath === relativePath,
  );
  if (openTab && !openTab.isDirty) {
    tabs.updateTabSql(openTab.id, content);
    tabs.markProjectFileSaved(openTab.id, revision, content);
  }
  useProjectFilesStore.getState().syncActiveProject();
  void useProjectFilesStore
    .getState()
    .refreshDirectory(parentProjectPath(relativePath))
    .catch(() => undefined);
}
