import { supportsProjectFilePreview } from "@/services/tauri/project-files.service";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";
import type { AssistantProjectFileProposal } from "@/ai/assistant/turns";
import {
  projectGitService,
  type ProjectGitFileVersions,
} from "@/services/tauri/project-git.service";
import { projectFilesService } from "@/services/tauri/project-files.service";

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

export function openProjectFileProposalInEditor(
  projectId: string,
  turnId: string,
  proposal: AssistantProjectFileProposal,
  expectedRoot?: string | null,
) {
  return useTabStore.getState().openAgentFileDiffTab({
    ...proposal,
    projectId,
    turnId,
    expectedRoot,
  });
}

export async function openProjectGitDiffInEditor(
  projectId: string,
  relativePath: string,
  expectedRoot: string,
  scope: ProjectGitFileVersions["scope"],
) {
  const [versions, diff] = await Promise.all([
    projectGitService.getFileVersions(
      projectId,
      relativePath,
      scope,
      expectedRoot,
    ),
    projectFilesService.getGitFileDiff(
      projectId,
      relativePath,
      expectedRoot,
      scope,
    ),
  ]);
  if (versions.binary || diff.binary) {
    throw new Error("Binary files cannot be opened in the text diff editor.");
  }
  return useTabStore.getState().openGitFileDiffTab({
    projectId,
    expectedRoot,
    relativePath: versions.relativePath,
    scope,
    originalContent: versions.originalContent,
    modifiedContent: versions.modifiedContent,
    additions: diff.additions,
    deletions: diff.deletions,
    originalMissing: versions.originalMissing,
    modifiedMissing: versions.modifiedMissing,
  });
}
