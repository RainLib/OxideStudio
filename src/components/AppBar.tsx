import {
  lazy,
  Fragment,
  Suspense,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  CircleArrowDown,
  FileJson2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Github,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCw,
  Settings,
  Trash2,
  AppWindow,
  type LucideIcon,
} from "lucide-react";
import { useAppUpdatePolling } from "@/hooks/useAppUpdatePolling";
import { useProjectStore } from "@/store/useProjectStore";
import { useUpdateStore } from "@/store/useUpdateStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  APP_EVENT_OPEN_SETTINGS,
  APP_EVENT_OPEN_VERSION_CONTROL,
} from "@/lib/actionEvents";
import type { Project } from "@/services/tauri/store.service";
import type { SettingsSection } from "@/components/settings/SettingsDialog";
import { EnterpriseAccountMenu } from "@/components/EnterpriseAccountMenu";
import {
  projectGitService,
  type GitHubCliStatus,
  type GitHubRepository,
} from "@/services/tauri/project-git.service";

type ProjectSourceMode = "local" | "git" | "github";

const SettingsDialog = lazy(() =>
  import("@/components/settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const UpdateDialog = lazy(() =>
  import("@/components/update/UpdateDialog").then((module) => ({
    default: module.UpdateDialog,
  })),
);
const WindowControls = lazy(() =>
  import("./WindowControls").then((module) => ({
    default: module.WindowControls,
  })),
);

function projectNameFromRootPath(rootPath: string) {
  const trimmed = rootPath.trim();
  const normalized =
    /^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:[\\/]$/.test(trimmed)
      ? trimmed
      : trimmed.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return (
    segments[segments.length - 1] ||
    (normalized.startsWith("/") ? "Root" : "Project")
  );
}

function projectRootKey(rootPath?: string | null) {
  const trimmed = rootPath?.trim();
  if (!trimmed) return undefined;
  const normalized =
    /^[\\/]+$/.test(trimmed) || /^[a-zA-Z]:[\\/]$/.test(trimmed)
      ? trimmed
      : trimmed.replace(/[\\/]+$/, "");
  return normalized.replace(/\\/g, "/").toLowerCase();
}

async function runWorkbenchAction(
  actionId: "window.new" | "settings.openJson",
) {
  const { findWorkbenchAction } = await import("@/lib/actions");
  await findWorkbenchAction(actionId)?.run();
}

interface AppBarProps {
  /**
   * Optional content to display in the center area
   */
  center?: ReactNode;

  /**
   * Optional content to display on the right side
   */
  right?: ReactNode;

  /**
   * Optional title to display on the left (after traffic lights spacing)
   */
  title?: string;
}

export function AppBar({ center, right }: AppBarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    SettingsSection | undefined
  >();
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectSourceMode, setProjectSourceMode] =
    useState<ProjectSourceMode>("local");
  const [projectAlias, setProjectAlias] = useState("");
  const [projectRootPath, setProjectRootPath] = useState("");
  const [gitRepositoryUrl, setGitRepositoryUrl] = useState("");
  const [shallowClone, setShallowClone] = useState(false);
  const [githubStatus, setGithubStatus] = useState<GitHubCliStatus | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [githubQuery, setGithubQuery] = useState("");
  const [githubRepositories, setGithubRepositories] = useState<GitHubRepository[]>([]);
  const [selectedGithubRepository, setSelectedGithubRepository] =
    useState<GitHubRepository | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusRequested, setGithubStatusRequested] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(
    null,
  );
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const {
    projects,
    activeProjectId,
    activeProjectName,
    setActiveProject,
    createProject,
    deleteProject,
  } = useProjectStore();
  const updateStatus = useUpdateStore((state) => state.status);
  const availableUpdate = useUpdateStore((state) => state.update);
  const updateDownloadedBytes = useUpdateStore((state) => state.downloadedBytes);
  const updateTotalBytes = useUpdateStore((state) => state.totalBytes);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  useAppUpdatePolling();
  // Detect if we're on macOS
  const isMacOS =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  useEffect(() => {
    const openSettings = (event: Event) => {
      const requestedSection =
        event instanceof CustomEvent &&
        typeof event.detail?.section === "string" &&
        isSettingsSection(event.detail.section)
          ? event.detail.section
          : undefined;
      setSettingsInitialSection(requestedSection);
      setShowSettings(true);
    };
    window.addEventListener(APP_EVENT_OPEN_SETTINGS, openSettings);
    return () =>
      window.removeEventListener(APP_EVENT_OPEN_SETTINGS, openSettings);
  }, []);

  const handleSettingsOpenChange = (open: boolean) => {
    setShowSettings(open);
    if (!open) setSettingsInitialSection(undefined);
  };

  const inferredProjectName = projectRootPath
    ? projectNameFromRootPath(projectRootPath)
    : "";
  const normalizedProjectName = projectAlias.trim() || inferredProjectName;
  const projectNameExists = useMemo(
    () =>
      projects.some(
        (project) =>
          project.name.trim().toLowerCase() ===
          normalizedProjectName.toLowerCase(),
      ),
    [normalizedProjectName, projects],
  );
  const projectPathExists = useMemo(() => {
    const selectedRootKey = projectRootKey(projectRootPath);
    return Boolean(
      selectedRootKey &&
      projects.some(
        (project) => projectRootKey(project.root_path) === selectedRootKey,
      ),
    );
  }, [projectRootPath, projects]);
  const projectGroups = useMemo(() => {
    const groups = new Map<string, Project[]>();
    for (const project of projects) {
      const group =
        project.origin === "managed"
          ? project.organization_name || "Organization"
          : "My Projects";
      groups.set(group, [...(groups.get(group) || []), project]);
    }
    return [...groups.entries()];
  }, [projects]);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [activeProjectId, projects],
  );

  const openProjectDialog = () => {
    setProjectAlias("");
    setProjectRootPath("");
    setProjectSourceMode("local");
    setGitRepositoryUrl("");
    setShallowClone(false);
    setGithubStatus(null);
    setGithubStatusRequested(false);
    setGithubToken("");
    setGithubQuery("");
    setGithubRepositories([]);
    setSelectedGithubRepository(null);
    setProjectError(null);
    setProjectMenuOpen(false);
    setProjectDialogOpen(true);
  };

  const chooseCloneDestination = async () => {
    setProjectError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose an Empty Clone Destination",
      });
      if (typeof selected === "string") setProjectRootPath(selected);
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "Failed to choose a clone destination.",
      );
    }
  };

  const refreshGithubStatus = async () => {
    setGithubStatusRequested(true);
    setGithubLoading(true);
    setProjectError(null);
    try {
      setGithubStatus(await projectGitService.getGitHubStatus());
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubLoading(false);
    }
  };

  const authenticateGithub = async () => {
    if (!githubToken.trim()) return;
    setGithubLoading(true);
    setProjectError(null);
    try {
      setGithubStatus(await projectGitService.authenticateGitHub(githubToken));
      setGithubToken("");
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubLoading(false);
    }
  };

  const searchGithub = async () => {
    if (!githubQuery.trim()) return;
    setGithubLoading(true);
    setProjectError(null);
    try {
      const repositories = await projectGitService.searchGitHub(githubQuery);
      setGithubRepositories(repositories);
      setSelectedGithubRepository((current) =>
        current && repositories.some((repo) => repo.fullName === current.fullName)
          ? current
          : repositories[0] || null,
      );
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubLoading(false);
    }
  };

  const chooseProjectDirectory = async () => {
    setProjectError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose Project Directory",
      });
      if (typeof selected === "string") {
        setProjectRootPath(selected);
      }
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "Failed to choose a project directory.",
      );
    }
  };

  const openUpdateDialog = () => {
    setSettingsMenuOpen(false);
    setUpdateDialogOpen(true);
    if (
      updateStatus === "idle" ||
      updateStatus === "up-to-date" ||
      updateStatus === "error" ||
      updateStatus === "unsupported"
    ) {
      void checkForUpdates({ force: true });
    }
  };

  const updateMenuLabel = (() => {
    if (updateStatus === "checking") return "Checking for Updates...";
    if (updateStatus === "downloading") {
      const progress =
        updateTotalBytes && updateTotalBytes > 0
          ? Math.min(
              100,
              Math.round((updateDownloadedBytes / updateTotalBytes) * 100),
            )
          : null;
      return progress === null
        ? "Downloading Update in Background..."
        : `Downloading Update... ${progress}%`;
    }
    if (updateStatus === "downloaded") return "Restart to Update...";
    if (availableUpdate) return `Update to ${availableUpdate.version}...`;
    return "Check for Updates...";
  })();

  const UpdateMenuIcon = (() => {
    if (updateStatus === "checking" || updateStatus === "downloading") {
      return LoaderCircle;
    }
    if (updateStatus === "downloaded") return RotateCw;
    if (updateStatus === "available") return CircleArrowDown;
    return RefreshCw;
  })();
  const showUpdateBadge =
    updateStatus === "available" || updateStatus === "downloaded";
  const showUpdateStatusButton =
    updateStatus === "available" ||
    updateStatus === "downloading" ||
    updateStatus === "downloaded";
  const updateProgress =
    updateStatus === "downloading" && updateTotalBytes && updateTotalBytes > 0
      ? Math.min(1, updateDownloadedBytes / updateTotalBytes)
      : null;

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectRootPath) {
      setProjectError("Choose a project directory.");
      return;
    }
    if (projectPathExists) {
      setProjectError("This directory is already linked to another project.");
      return;
    }
    if (!normalizedProjectName) {
      setProjectError("Enter a project alias or choose a named directory.");
      return;
    }
    if (projectNameExists) {
      setProjectError("A project with this name already exists.");
      return;
    }
    if (projectSourceMode === "git" && !gitRepositoryUrl.trim()) {
      setProjectError("Enter a Git repository URL.");
      return;
    }
    if (projectSourceMode === "github" && !selectedGithubRepository) {
      setProjectError("Select a GitHub repository.");
      return;
    }

    setIsCreatingProject(true);
    setProjectError(null);
    try {
      if (projectSourceMode !== "local") {
        await projectGitService.clone({
          source:
            projectSourceMode === "github"
              ? selectedGithubRepository!.fullName
              : gitRepositoryUrl,
          destination: projectRootPath,
          github: projectSourceMode === "github",
          shallowDepth: shallowClone ? 1 : null,
        });
      }
      await createProject(normalizedProjectName, projectRootPath);
      setProjectDialogOpen(false);
      setProjectAlias("");
      setProjectRootPath("");
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "Failed to create project.",
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  useEffect(() => {
    if (
      projectDialogOpen &&
      projectSourceMode === "github" &&
      githubStatus === null &&
      !githubStatusRequested &&
      !githubLoading
    ) {
      void refreshGithubStatus();
    }
  }, [
    githubLoading,
    githubStatus,
    githubStatusRequested,
    projectDialogOpen,
    projectSourceMode,
  ]);

  const handleDeleteProject = async () => {
    if (!projectToDelete || isDeletingProject) return;

    setIsDeletingProject(true);
    setProjectDeleteError(null);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      setProjectDeleteError(
        error instanceof Error ? error.message : "Failed to delete project.",
      );
    } finally {
      setIsDeletingProject(false);
    }
  };

  return (
    <div className="wb-titlebar flex items-center relative">
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsDialog
            open
            initialSection={settingsInitialSection}
            onOpenChange={handleSettingsOpenChange}
          />
        </Suspense>
      )}
      {updateDialogOpen && (
        <Suspense fallback={null}>
          <UpdateDialog open onOpenChange={setUpdateDialogOpen} />
        </Suspense>
      )}
      <div
        data-tauri-drag-region
        className={`flex h-full items-center shrink-0 ${isMacOS ? "w-20" : "w-3"}`}
      />

      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 items-center gap-1"
      >
        <div
          data-tauri-drag-region
          className="flex h-full min-w-0 items-center gap-1.5 px-1.5 text-[12px] font-medium"
        >
          <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="wb-text-button h-6 px-1.5 text-[12px] text-[hsl(var(--wb-text))]"
                title="Project"
              >
                <span className="max-w-36 truncate">
                  {activeProjectName || "sqls"}
                </span>
                <ChevronDown size={12} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={6}
              className="w-80 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_4px_8px_rgba(0,0,0,0.35)]"
            >
              <div className="max-h-72 overflow-y-auto">
                {projectGroups.map(([group, groupedProjects]) => (
                  <Fragment key={group}>
                    <div className="px-2 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wide wb-muted">
                      {group}
                    </div>
                    {groupedProjects.map((project) => {
                      const isActive = project.id === activeProjectId;
                      const isDefault = project.id === "sqls";
                      const isManaged = project.origin === "managed";
                      return (
                    <div
                      key={project.id}
                      className={`group flex min-h-10 items-center rounded-[3px] ${
                        isActive
                          ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
                          : "hover:bg-[hsl(var(--wb-hover))]"
                      }`}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                        onClick={() => {
                          if (setActiveProject(project.id)) {
                            setProjectMenuOpen(false);
                          }
                        }}
                      >
                        <FolderOpen
                          size={14}
                          className={
                            isActive
                              ? "shrink-0 text-[hsl(var(--wb-accent))]"
                              : "shrink-0 text-[hsl(var(--wb-text-muted))]"
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] leading-4">
                            {project.name}
                          </span>
                          <span
                            className="block truncate text-[10px] leading-3 text-[hsl(var(--wb-text-muted))]"
                            title={project.root_path || undefined}
                          >
                            {isManaged
                              ? `${project.managed_data_sources?.length || 0} managed data sources`
                              : project.root_path ||
                              (isDefault
                                ? "Built-in workspace"
                                : "No project directory")}
                          </span>
                        </span>
                      </button>
                      {!isDefault && !isManaged && (
                        <button
                          type="button"
                          className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[hsl(var(--wb-text-muted))] opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-[hsl(var(--destructive)/0.12)] hover:text-[hsl(var(--destructive))] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--destructive))] group-hover:opacity-100 group-focus-within:opacity-100"
                          title={`Delete ${project.name}`}
                          aria-label={`Delete project ${project.name}`}
                          onClick={() => {
                            setProjectMenuOpen(false);
                            setProjectDeleteError(null);
                            setProjectToDelete(project);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
              <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
              <button
                type="button"
                className="flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-45"
                disabled={!activeProject || activeProject.origin === "managed"}
                onClick={() => {
                  setProjectMenuOpen(false);
                  window.dispatchEvent(
                    new CustomEvent(APP_EVENT_OPEN_VERSION_CONTROL),
                  );
                }}
              >
                <GitBranch size={13} />
                <span>Version Control…</span>
              </button>
              <button
                type="button"
                className="flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] hover:bg-[hsl(var(--wb-hover))]"
                onClick={openProjectDialog}
              >
                <Plus size={13} />
                <span>New Project</span>
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {center ? (
          <div
            data-tauri-drag-region
            className="flex min-w-0 flex-1 items-center justify-center px-2"
          >
            {center}
          </div>
        ) : (
          <div
            data-tauri-drag-region
            className="hidden min-w-0 flex-1 items-center justify-center sm:flex"
          />
        )}
      </div>

      <div className="h-full flex items-center gap-1 shrink-0 ml-auto pr-1">
        {right && <div className="flex items-center gap-1 pr-1">{right}</div>}
        <div className="flex items-center gap-0.5 pl-0.5">
          {showUpdateStatusButton && (
            <button
              type="button"
              className="wb-icon-button relative"
              title={updateMenuLabel}
              aria-label={updateMenuLabel}
              onClick={openUpdateDialog}
            >
              {updateStatus === "downloading" ? (
                updateProgress === null ? (
                  <LoaderCircle
                    size={15}
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <svg
                    viewBox="0 0 20 20"
                    className="h-[15px] w-[15px] -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="opacity-20"
                    />
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      pathLength="1"
                      strokeDasharray="1"
                      strokeDashoffset={1 - updateProgress}
                      className="text-[hsl(var(--wb-accent))] transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
                    />
                  </svg>
                )
              ) : updateStatus === "downloaded" ? (
                <RotateCw size={14} className="text-[hsl(var(--wb-accent))]" />
              ) : (
                <CircleArrowDown
                  size={14}
                  className="text-[hsl(var(--wb-accent))]"
                />
              )}
            </button>
          )}
          <EnterpriseAccountMenu />
          <Popover open={settingsMenuOpen} onOpenChange={setSettingsMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="wb-icon-button relative"
                title={
                  showUpdateBadge ? "Settings · Update available" : "Settings"
                }
                aria-label={
                  showUpdateBadge ? "Settings, update available" : "Settings"
                }
              >
                <Settings size={14} />
                {showUpdateBadge && (
                  <span
                    aria-hidden="true"
                    className="absolute right-[2px] top-[2px] h-1.5 w-1.5 rounded-full bg-[hsl(var(--wb-accent))] shadow-[0_0_0_1px_hsl(var(--wb-titlebar))]"
                  />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-[238px] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[13px] text-[hsl(var(--wb-text))] shadow-[0_18px_44px_rgba(0,0,0,0.46)]"
            >
              <SettingsMenuItem
                icon={AppWindow}
                label="New Window"
                shortcut={isMacOS ? "⌘⇧N" : "Ctrl+Shift+N"}
                onClick={() => {
                  setSettingsMenuOpen(false);
                  void runWorkbenchAction("window.new");
                }}
              />
              <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
              <SettingsMenuItem
                icon={UpdateMenuIcon}
                iconSpinning={
                  updateStatus === "checking" || updateStatus === "downloading"
                }
                label={updateMenuLabel}
                badge={
                  updateStatus === "available" || updateStatus === "downloaded"
                    ? "New"
                    : undefined
                }
                active={showUpdateBadge}
                onClick={openUpdateDialog}
              />
              <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
              <SettingsMenuItem
                icon={Settings}
                label="Settings..."
                shortcut="⌘,"
                onClick={() => {
                  setSettingsMenuOpen(false);
                  setShowSettings(true);
                }}
              />
              <SettingsMenuItem
                icon={FileJson2}
                label="Open settings.json"
                onClick={() => {
                  setSettingsMenuOpen(false);
                  void runWorkbenchAction("settings.openJson");
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        {!isMacOS && (
          <Suspense fallback={<div className="h-full w-[132px]" />}>
            <WindowControls />
          </Suspense>
        )}
      </div>

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
                    Open a local folder or clone a repository into a new database workspace.
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
                    HTTPS, SSH and Git protocol URLs are supported. Credentials embedded in URLs are rejected.
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

      <Dialog
        open={Boolean(projectToDelete)}
        onOpenChange={(open) => {
          if (!open && !isDeletingProject) {
            setProjectToDelete(null);
            setProjectDeleteError(null);
          }
        }}
      >
        <DialogContent className="w-[440px] max-w-[calc(100vw-32px)] gap-4 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-5 text-[hsl(var(--wb-text))] shadow-[0_4px_8px_rgba(0,0,0,0.35)]">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Delete project?</DialogTitle>
            <DialogDescription className="text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
              Delete <strong>{projectToDelete?.name}</strong> from OxideStudio.
              Its data sources and cached metadata will be removed. Files in the
              linked directory will stay on disk.
            </DialogDescription>
          </DialogHeader>
          {projectToDelete?.root_path && (
            <div
              className="truncate rounded-[4px] bg-[hsl(var(--wb-editor))] px-3 py-2 font-mono text-[11px] text-[hsl(var(--wb-text-muted))]"
              title={projectToDelete.root_path}
            >
              {projectToDelete.root_path}
            </div>
          )}
          {projectDeleteError && (
            <div className="rounded-[4px] bg-[hsl(var(--destructive)/0.10)] px-3 py-2 text-[12px] text-[hsl(var(--destructive))]">
              {projectDeleteError}
            </div>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-3 text-[12px]"
              disabled={isDeletingProject}
              onClick={() => setProjectToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-8 px-3 text-[12px]"
              disabled={isDeletingProject}
              onClick={() => void handleDeleteProject()}
            >
              <Trash2 size={13} className="mr-1.5" />
              {isDeletingProject ? "Deleting…" : "Delete Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GithubProjectSource({
  status,
  token,
  query,
  repositories,
  selectedRepository,
  loading,
  disabled,
  onTokenChange,
  onQueryChange,
  onAuthenticate,
  onRefresh,
  onSearch,
  onSelect,
}: {
  status: GitHubCliStatus | null;
  token: string;
  query: string;
  repositories: GitHubRepository[];
  selectedRepository: GitHubRepository | null;
  loading: boolean;
  disabled: boolean;
  onTokenChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onAuthenticate: () => void;
  onRefresh: () => void;
  onSearch: () => void;
  onSelect: (repository: GitHubRepository) => void;
}) {
  if (!status) {
    return (
      <div className="flex h-16 items-center justify-center rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-[10px] text-[hsl(var(--wb-text-muted))]">
        {loading ? (
          <>
            <LoaderCircle size={13} className="mr-2 animate-spin" />
            Checking GitHub CLI…
          </>
        ) : (
          <button type="button" className="wb-text-button h-7 px-3" onClick={onRefresh}>
            Check GitHub CLI
          </button>
        )}
      </div>
    );
  }

  if (!status.installed) {
    return (
      <div className="rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-3 py-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
        GitHub CLI (`gh`) was not found. Install it from cli.github.com, then
        refresh this check. Git URL cloning remains available without `gh`.
        <button
          type="button"
          className="ml-2 text-[hsl(var(--wb-accent))] hover:underline"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
    );
  }

  if (!status.authenticated) {
    return (
      <div className="space-y-2 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3">
        <div className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          Authenticate `gh` with a GitHub token. OxideStudio sends it once on
          standard input and never stores it; credential storage is owned by `gh`.
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder="GitHub personal access token"
            autoComplete="off"
            className="h-8 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
            disabled={disabled || loading}
          />
          <button
            type="button"
            className="wb-text-button h-8 px-3"
            disabled={!token.trim() || disabled || loading}
            onClick={onAuthenticate}
          >
            {loading && <LoaderCircle size={12} className="mr-1 animate-spin" />}
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Check size={11} />
          Signed in{status.account ? ` as ${status.account}` : ""}
        </span>
        {status.version && <span className="truncate">· {status.version}</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch();
            }
          }}
          placeholder="Search repositories by name, owner, or topic"
          className="h-8 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          disabled={disabled || loading}
        />
        <button
          type="button"
          className="wb-text-button h-8 px-3"
          disabled={!query.trim() || disabled || loading}
          onClick={onSearch}
        >
          {loading && <LoaderCircle size={12} className="mr-1 animate-spin" />}
          Search
        </button>
      </div>
      {repositories.length > 0 && (
        <div className="max-h-36 overflow-y-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))]">
          {repositories.map((repository) => {
            const selected = selectedRepository?.fullName === repository.fullName;
            return (
              <button
                key={repository.fullName}
                type="button"
                className={`flex w-full items-start gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2.5 py-2 text-left last:border-b-0 ${
                  selected
                    ? "bg-[hsl(var(--wb-active))]"
                    : "hover:bg-[hsl(var(--wb-hover))]"
                }`}
                onClick={() => onSelect(repository)}
              >
                <Github
                  size={13}
                  className={
                    selected
                      ? "mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
                      : "mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[11px]">
                    <strong className="truncate font-medium">
                      {repository.fullName}
                    </strong>
                    {repository.isPrivate && (
                      <span className="text-[8px] uppercase text-[hsl(var(--wb-text-muted))]">
                        private
                      </span>
                    )}
                  </span>
                  {repository.description && (
                    <span className="block truncate text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                      {repository.description}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[9px] text-[hsl(var(--wb-text-muted))]">
                  ★ {repository.stargazersCount}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isSettingsSection(value: string): value is SettingsSection {
  return [
    "appearance",
    "workbench",
    "keymap",
    "editor",
    "dataEditor",
    "databaseExplorer",
    "ai",
  ].includes(value);
}

function SettingsMenuItem({
  icon: Icon,
  label,
  shortcut,
  badge,
  active,
  iconSpinning,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  shortcut?: string;
  badge?: string;
  active?: boolean;
  iconSpinning?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-7 w-full items-center gap-2 rounded-[4px] px-2 text-left transition-colors ${
        active
          ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
          : "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]"
      }`}
      onClick={onClick}
    >
      <span className="flex w-4 shrink-0 justify-center text-[hsl(var(--wb-text-muted))]">
        {Icon ? (
          <Icon size={14} className={iconSpinning ? "animate-spin" : ""} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge && (
        <span className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-accent)/0.16)] px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--wb-accent))]">
          {badge}
        </span>
      )}
      {shortcut && (
        <span className="shrink-0 text-[12px] text-[hsl(var(--wb-text-muted))]">
          {shortcut}
        </span>
      )}
    </button>
  );
}
