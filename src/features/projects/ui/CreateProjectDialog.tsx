import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectSourceMode } from "@/features/projects/model/projectIdentity";
import { GithubProjectSource } from "@/features/projects/ui/GithubProjectSource";
import type {
  GitHubCliStatus,
  GitHubRepository,
} from "@/services/tauri/project-git.service";
import { Check, FolderOpen, FolderPlus, GitBranch, Github } from "lucide-react";

interface CreateProjectDialogProps {
  projectDialogOpen: boolean;
  setProjectDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleCreateProject: (
    event: React.FormEvent<HTMLFormElement>,
  ) => Promise<void>;
  projectSourceMode: ProjectSourceMode;
  setProjectSourceMode: React.Dispatch<React.SetStateAction<ProjectSourceMode>>;
  setProjectError: React.Dispatch<React.SetStateAction<string | null>>;
  isCreatingProject: boolean;
  gitRepositoryUrl: string;
  setGitRepositoryUrl: React.Dispatch<React.SetStateAction<string>>;
  githubStatus: GitHubCliStatus | null;
  githubToken: string;
  githubQuery: string;
  githubRepositories: GitHubRepository[];
  selectedGithubRepository: GitHubRepository | null;
  githubLoading: boolean;
  setGithubToken: React.Dispatch<React.SetStateAction<string>>;
  setGithubQuery: React.Dispatch<React.SetStateAction<string>>;
  authenticateGithub: () => Promise<void>;
  refreshGithubStatus: () => Promise<void>;
  searchGithub: () => Promise<void>;
  setSelectedGithubRepository: React.Dispatch<
    React.SetStateAction<GitHubRepository | null>
  >;
  chooseProjectDirectory: () => Promise<void>;
  chooseCloneDestination: () => Promise<void>;
  projectRootPath: string;
  shallowClone: boolean;
  setShallowClone: React.Dispatch<React.SetStateAction<boolean>>;
  projectAlias: string;
  setProjectAlias: React.Dispatch<React.SetStateAction<string>>;
  inferredProjectName: string;
  normalizedProjectName: string;
  projectError: string | null;
  projectPathExists: boolean;
  projectNameExists: boolean;
}

export function CreateProjectDialog({
  projectDialogOpen,
  setProjectDialogOpen,
  handleCreateProject,
  projectSourceMode,
  setProjectSourceMode,
  setProjectError,
  isCreatingProject,
  gitRepositoryUrl,
  setGitRepositoryUrl,
  githubStatus,
  githubToken,
  githubQuery,
  githubRepositories,
  selectedGithubRepository,
  githubLoading,
  setGithubToken,
  setGithubQuery,
  authenticateGithub,
  refreshGithubStatus,
  searchGithub,
  setSelectedGithubRepository,
  chooseProjectDirectory,
  chooseCloneDestination,
  projectRootPath,
  shallowClone,
  setShallowClone,
  projectAlias,
  setProjectAlias,
  inferredProjectName,
  normalizedProjectName,
  projectError,
  projectPathExists,
  projectNameExists,
}: CreateProjectDialogProps) {
  return (
    <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
      <DialogContent className="max-h-[calc(100vh-32px)] w-[640px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_4px_8px_rgba(0,0,0,0.42)]">
        <form
          onSubmit={handleCreateProject}
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 text-left">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-accent))]">
                <FolderPlus size={15} />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-[13px] font-semibold leading-5 tracking-normal text-[hsl(var(--wb-text))]">
                  New Project
                </DialogTitle>
                <DialogDescription className="text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  Open a local folder or clone a repository into a new database
                  workspace.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <div className="grid grid-cols-3 gap-1 rounded-[4px] bg-[hsl(var(--wb-panel))] p-1">
              {(
                [
                  ["local", FolderOpen, "Local folder"],
                  ["git", GitBranch, "Git URL"],
                  ["github", Github, "GitHub"],
                ] as const
              ).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  autoFocus={mode === "local"}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-[3px] text-[11px] transition-colors ${
                    projectSourceMode === mode
                      ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))] shadow-sm"
                      : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                  }`}
                  onClick={() => {
                    setProjectSourceMode(mode);
                    setProjectError(null);
                  }}
                  disabled={isCreatingProject}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>

            {projectSourceMode === "git" && (
              <div className="space-y-1.5">
                <label
                  htmlFor="git-repository-url"
                  className="block text-[11px] font-medium text-[hsl(var(--wb-text-muted))]"
                >
                  Repository URL
                </label>
                <input
                  id="git-repository-url"
                  value={gitRepositoryUrl}
                  onChange={(event) => {
                    setGitRepositoryUrl(event.target.value);
                    setProjectError(null);
                  }}
                  placeholder="https://github.com/owner/repository.git"
                  className="h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
                  disabled={isCreatingProject}
                />
                <p className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  HTTPS, SSH and Git protocol URLs are supported. Credentials
                  embedded in URLs are rejected.
                </p>
              </div>
            )}

            {projectSourceMode === "github" && (
              <GithubProjectSource
                status={githubStatus}
                token={githubToken}
                query={githubQuery}
                repositories={githubRepositories}
                selectedRepository={selectedGithubRepository}
                loading={githubLoading}
                disabled={isCreatingProject}
                onTokenChange={setGithubToken}
                onQueryChange={setGithubQuery}
                onAuthenticate={() => void authenticateGithub()}
                onRefresh={() => void refreshGithubStatus()}
                onSearch={() => void searchGithub()}
                onSelect={setSelectedGithubRepository}
              />
            )}

            <div className="space-y-1.5">
              <label className="block text-[11px] font-medium text-[hsl(var(--wb-text-muted))]">
                {projectSourceMode === "local"
                  ? "Project directory"
                  : "Empty clone destination"}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-left text-[12px] outline-none transition-colors hover:border-[hsl(var(--wb-border-strong))] focus-visible:border-[hsl(var(--wb-accent))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent)/0.35)]"
                  onClick={() =>
                    void (projectSourceMode === "local"
                      ? chooseProjectDirectory()
                      : chooseCloneDestination())
                  }
                  disabled={isCreatingProject}
                >
                  <FolderOpen
                    size={14}
                    className="shrink-0 text-[hsl(var(--wb-accent))]"
                  />
                  <span
                    className={`truncate ${
                      projectRootPath
                        ? "text-[hsl(var(--wb-text))]"
                        : "text-[hsl(var(--wb-text-muted))]"
                    }`}
                    title={projectRootPath || undefined}
                  >
                    {projectRootPath ||
                      (projectSourceMode === "local"
                        ? "Choose a folder…"
                        : "Choose an empty folder…")}
                  </span>
                </button>
                <button
                  type="button"
                  className="wb-text-button h-8 shrink-0 border border-[hsl(var(--wb-border))] px-3"
                  onClick={() =>
                    void (projectSourceMode === "local"
                      ? chooseProjectDirectory()
                      : chooseCloneDestination())
                  }
                  disabled={isCreatingProject}
                >
                  Browse…
                </button>
              </div>
              <p className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {projectSourceMode === "local"
                  ? "The folder name becomes the project name automatically."
                  : "The repository is cloned here before the project is linked."}
              </p>
            </div>

            {projectSourceMode !== "local" && (
              <label className="flex items-center gap-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
                <input
                  type="checkbox"
                  checked={shallowClone}
                  onChange={(event) => setShallowClone(event.target.checked)}
                  disabled={isCreatingProject}
                />
                Shallow clone (latest commit only)
              </label>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="project-alias"
                className="block text-[11px] font-medium text-[hsl(var(--wb-text-muted))]"
              >
                Project alias <span className="font-normal">(optional)</span>
              </label>
              <input
                id="project-alias"
                value={projectAlias}
                onChange={(event) => {
                  setProjectAlias(event.target.value);
                  setProjectError(null);
                }}
                placeholder={inferredProjectName || "Display name"}
                className="h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none transition-colors placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))] focus:ring-1 focus:ring-[hsl(var(--wb-accent)/0.35)]"
                disabled={isCreatingProject}
              />
              <p className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {normalizedProjectName
                  ? `Shown as “${normalizedProjectName}”. Leave blank to use the folder name.`
                  : "Leave blank to use the selected folder name."}
              </p>
            </div>

            <div className="min-h-4 text-[11px] leading-4">
              {projectError ? (
                <span className="text-[hsl(var(--destructive))]">
                  {projectError}
                </span>
              ) : projectPathExists ? (
                <span className="text-[hsl(var(--destructive))]">
                  This directory is already linked to another project.
                </span>
              ) : projectNameExists ? (
                <span className="text-[hsl(var(--destructive))]">
                  A project with this display name already exists.
                </span>
              ) : (
                <span className="text-[hsl(var(--wb-text-muted))]">
                  {projectSourceMode === "local"
                    ? "The selected folder is only linked; existing files are not modified."
                    : "Remote authentication uses your existing Git/SSH credentials; GitHub authentication is managed by the GitHub CLI."}
                </span>
              )}
            </div>
          </div>

          <DialogFooter className="flex-row justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-4 py-3 sm:space-x-0">
            <button
              type="button"
              className="wb-text-button h-7 px-3"
              onClick={() => setProjectDialogOpen(false)}
              disabled={isCreatingProject}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-[hsl(var(--wb-accent))] px-3 text-[12px] font-medium text-[hsl(var(--wb-accent-foreground))] transition-colors hover:brightness-110 disabled:pointer-events-none disabled:opacity-55"
              disabled={
                isCreatingProject ||
                !projectRootPath ||
                !normalizedProjectName ||
                projectNameExists ||
                projectPathExists ||
                (projectSourceMode === "git" && !gitRepositoryUrl.trim()) ||
                (projectSourceMode === "github" && !selectedGithubRepository)
              }
            >
              <Check size={13} />
              {isCreatingProject
                ? projectSourceMode === "local"
                  ? "Creating..."
                  : "Cloning..."
                : projectSourceMode === "local"
                  ? "Create"
                  : "Clone and create"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
