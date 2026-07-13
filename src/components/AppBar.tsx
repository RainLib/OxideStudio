import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { WindowControls } from "./WindowControls";
import {
  Check,
  ChevronDown,
  CircleArrowDown,
  FileJson2,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCw,
  Settings,
  Trash2,
  AppWindow,
  type LucideIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { UpdateDialog } from "@/components/update/UpdateDialog";
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
import { APP_EVENT_OPEN_SETTINGS, findWorkbenchAction } from "@/lib/actions";
import type { Project } from "@/services/tauri/store.service";

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
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectAlias, setProjectAlias] = useState("");
  const [projectRootPath, setProjectRootPath] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(
    null
  );
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const {
    projects,
    activeProjectId,
    activeProjectName,
    loadProjects,
    setActiveProject,
    createProject,
    deleteProject,
  } = useProjectStore();
  const updateStatus = useUpdateStore((state) => state.status);
  const availableUpdate = useUpdateStore((state) => state.update);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  useAppUpdatePolling();
  // Detect if we're on macOS
  const isMacOS =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const openSettings = () => setShowSettings(true);
    window.addEventListener(APP_EVENT_OPEN_SETTINGS, openSettings);
    return () => window.removeEventListener(APP_EVENT_OPEN_SETTINGS, openSettings);
  }, []);

  const inferredProjectName = projectRootPath
    ? projectNameFromRootPath(projectRootPath)
    : "";
  const normalizedProjectName = projectAlias.trim() || inferredProjectName;
  const projectNameExists = useMemo(
    () =>
      projects.some(
        (project) =>
          project.name.trim().toLowerCase() ===
          normalizedProjectName.toLowerCase()
      ),
    [normalizedProjectName, projects]
  );
  const projectPathExists = useMemo(() => {
    const selectedRootKey = projectRootKey(projectRootPath);
    return Boolean(
      selectedRootKey &&
        projects.some(
          (project) => projectRootKey(project.root_path) === selectedRootKey
        )
    );
  }, [projectRootPath, projects]);

  const openProjectDialog = () => {
    setProjectAlias("");
    setProjectRootPath("");
    setProjectError(null);
    setProjectMenuOpen(false);
    setProjectDialogOpen(true);
  };

  const chooseProjectDirectory = async () => {
    setProjectError(null);
    try {
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
          : "Failed to choose a project directory."
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
    if (updateStatus === "downloading") return "Downloading Update...";
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

    setIsCreatingProject(true);
    setProjectError(null);
    try {
      await createProject(normalizedProjectName, projectRootPath);
      setProjectDialogOpen(false);
      setProjectAlias("");
      setProjectRootPath("");
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "Failed to create project."
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete || isDeletingProject) return;

    setIsDeletingProject(true);
    setProjectDeleteError(null);
    try {
      await deleteProject(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      setProjectDeleteError(
        error instanceof Error ? error.message : "Failed to delete project."
      );
    } finally {
      setIsDeletingProject(false);
    }
  };

  return (
    <div className="wb-titlebar flex items-center relative">
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      <UpdateDialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen} />
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
              <div className="px-2 py-1 text-[10px] font-semibold uppercase wb-muted">
                Projects
              </div>
              <div className="max-h-72 overflow-y-auto">
                {projects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  const isDefault = project.id === "sqls";
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
                            {project.root_path ||
                              (isDefault
                                ? "Built-in workspace"
                                : "No project directory")}
                          </span>
                        </span>
                      </button>
                      {!isDefault && (
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
              </div>
              <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
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
        {right && (
          <div className="flex items-center gap-1 pr-1">
            {right}
          </div>
        )}
        <div className="flex items-center gap-0.5 pl-0.5">
          <Popover open={settingsMenuOpen} onOpenChange={setSettingsMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="wb-icon-button relative"
                title={showUpdateBadge ? "Settings · Update available" : "Settings"}
                aria-label={showUpdateBadge ? "Settings, update available" : "Settings"}
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
                  void findWorkbenchAction("window.new")?.run();
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
                  void findWorkbenchAction("settings.openJson")?.run();
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        {!isMacOS && <WindowControls />}
      </div>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="w-[500px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_4px_8px_rgba(0,0,0,0.42)]">
          <form onSubmit={handleCreateProject}>
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
                    Link a folder to a separate database workspace.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 px-4 py-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] font-medium text-[hsl(var(--wb-text-muted))]">
                  Project directory
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    autoFocus
                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-left text-[12px] outline-none transition-colors hover:border-[hsl(var(--wb-border-strong))] focus-visible:border-[hsl(var(--wb-accent))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent)/0.35)]"
                    onClick={() => void chooseProjectDirectory()}
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
                      {projectRootPath || "Choose a folder…"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="wb-text-button h-8 shrink-0 border border-[hsl(var(--wb-border))] px-3"
                    onClick={() => void chooseProjectDirectory()}
                    disabled={isCreatingProject}
                  >
                    Browse…
                  </button>
                </div>
                <p className="text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  The folder name becomes the project name automatically.
                </p>
              </div>

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
                    The selected folder is only linked; existing files are not modified.
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
                  projectPathExists
                }
              >
                <Check size={13} />
                {isCreatingProject ? "Creating..." : "Create"}
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
        {Icon ? <Icon size={14} className={iconSpinning ? "animate-spin" : ""} /> : null}
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
