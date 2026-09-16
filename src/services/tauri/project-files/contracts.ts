
export type ProjectEntryKind = "file" | "directory";

export interface ProjectFileEntry {
  relativePath: string;
  name: string;
  kind: ProjectEntryKind;
  size: number;
  modifiedAt: number | null;
  isSymlink: boolean;
}

export interface ProjectFileRead {
  relativePath: string;
  content: string;
  revision: string;
}

export interface ProjectFilePreview {
  relativePath: string;
  mediaType: string;
  dataBase64: string;
  revision: string;
  size: number;
}

export interface ProjectFileWriteResult {
  relativePath: string;
  revision: string;
  previousRevision?: string | null;
  introducedLines?: number[];
  lineEvidenceTruncated?: boolean;
}

export interface ProjectCompletionSnippet {
  relativePath: string;
  content: string;
}

/** A bounded saved SQL file mirrored into the local language service. */
export interface ProjectLspDocument {
  relativePath: string;
  content: string;
}

export interface ProjectGitFileChange {
  relativePath: string;
  previousPath?: string | null;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface ProjectGitChangeSet {
  isRepository: boolean;
  branch?: string | null;
  head?: string | null;
  files: ProjectGitFileChange[];
  truncated: boolean;
}

export type ProjectGitDiffScope = "all" | "staged" | "working";
export type ProjectGitRevisionStatus = "available" | "missing" | "unavailable";

export interface ProjectGitFileDiff {
  relativePath: string;
  patch: string;
  additions: number;
  deletions: number;
  binary: boolean;
  truncated: boolean;
  currentSideRevision: string | null;
  currentSideRevisionStatus: ProjectGitRevisionStatus;
}
