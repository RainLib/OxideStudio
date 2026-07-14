import { supportsProjectFilePreview } from "@/services/tauri/project-files.service";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";

export async function openProjectFileInEditor(relativePath: string) {
  useProjectFilesStore.getState().syncActiveProject();
  const files = useProjectFilesStore.getState();
  const tabs = useTabStore.getState();

  if (supportsProjectFilePreview(relativePath)) {
    const preview = await files.readPreview(relativePath);
    return tabs.openProjectFilePreviewTab(
      files.projectId,
      preview.relativePath,
      preview.mediaType,
      preview.dataBase64,
      preview.revision,
      preview.size,
      files.rootPath
    );
  }

  const document = await files.readFile(relativePath);
  return tabs.openProjectFileTab(
    files.projectId,
    document.relativePath,
    document.content,
    document.revision,
    files.rootPath
  );
}
