import type { ProjectGitDiffScope } from "@/services/tauri/project-files.service";

export interface GitFileDiffPreview {
  projectId: string;
  expectedRoot?: string | null;
  relativePath: string;
  scope: ProjectGitDiffScope;
  originalContent: string;
  modifiedContent: string;
  additions: number;
  deletions: number;
  originalMissing: boolean;
  modifiedMissing: boolean;
}
