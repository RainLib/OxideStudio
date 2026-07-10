import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { WindowControls } from "./WindowControls";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Download,
  FolderPlus,
  Keyboard,
  Palette,
  Plug,
  Plus,
  Settings,
} from "lucide-react";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useProjectStore } from "@/store/useProjectStore";
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
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const {
    projects,
    activeProjectId,
    activeProjectName,
    loadProjects,
    setActiveProject,
    createProject,
  } = useProjectStore();
  // Detect if we're on macOS
  const isMacOS =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const normalizedProjectName = projectName.trim();
  const projectNameExists = useMemo(
    () =>
      projects.some(
        (project) =>
          project.name.trim().toLowerCase() ===
          normalizedProjectName.toLowerCase()
      ),
    [normalizedProjectName, projects]
  );

  const openProjectDialog = () => {
    setProjectName("");
    setProjectError(null);
    setProjectMenuOpen(false);
    setProjectDialogOpen(true);
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedProjectName) {
      setProjectError("Enter a project name.");
      return;
    }
    if (projectNameExists) {
      setProjectError("A project with this name already exists.");
      return;
    }

    setIsCreatingProject(true);
    setProjectError(null);
    try {
      await createProject(normalizedProjectName);
      setProjectDialogOpen(false);
      setProjectName("");
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "Failed to create project."
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  return (
    <div data-tauri-drag-region className="wb-titlebar flex items-center relative">
      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
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
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-brand))] text-white text-[11px] font-semibold shadow-[0_0_0_1px_rgba(255,255,255,0.10)]">
            S
          </span>
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
              className="w-64 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_14px_32px_rgba(0,0,0,0.35)]"
            >
              <div className="px-2 py-1 text-[10px] font-semibold uppercase wb-muted">
                Projects
              </div>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`flex h-7 w-full items-center rounded-[3px] px-2 text-left text-[12px] ${
                    project.id === activeProjectId
                      ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
                      : "hover:bg-[hsl(var(--wb-hover))]"
                  }`}
                  onClick={() => {
                    setActiveProject(project.id);
                    setProjectMenuOpen(false);
                  }}
                >
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
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
          <div data-tauri-drag-region className="flex items-center gap-1 pr-1">
            {right}
          </div>
        )}
        <div className="flex items-center gap-0.5 border-l border-[hsl(var(--wb-border-subtle))] pl-1">
          <Popover open={settingsMenuOpen} onOpenChange={setSettingsMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="wb-icon-button"
                title="Settings"
                aria-label="Settings"
              >
                <Settings size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-[286px] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[13px] text-[hsl(var(--wb-text))] shadow-[0_18px_44px_rgba(0,0,0,0.46)]"
            >
              <SettingsMenuItem icon={Download} label="Update Performance Testing Plugin..." />
              <SettingsMenuItem
                icon={Settings}
                label="Settings..."
                shortcut="⌘,"
                active
                onClick={() => {
                  setSettingsMenuOpen(false);
                  setShowSettings(true);
                }}
              />
              <SettingsMenuItem icon={Plug} label="Plugins..." />
              <SettingsMenuSeparator />
              <SettingsMenuItem icon={CircleSlash} label="Backup and Sync..." suffix="Off" mutedSuffix />
              <SettingsMenuSeparator />
              <SettingsMenuItem icon={Palette} label="Theme..." />
              <SettingsMenuItem icon={Keyboard} label="Keymap..." />
              <SettingsMenuItem label="View Mode..." />
              <SettingsMenuSeparator />
              <SettingsMenuItem label="Customize Main Toolbar" trailing />
            </PopoverContent>
          </Popover>
        </div>
        {!isMacOS && <WindowControls />}
      </div>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_18px_48px_rgba(0,0,0,0.42)]">
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
                    Create a separate workspace for database connections and cached metadata.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-2 px-4 py-4">
              <label
                htmlFor="project-name"
                className="block text-[11px] font-medium text-[hsl(var(--wb-text-muted))]"
              >
                Project name
              </label>
              <input
                id="project-name"
                autoFocus
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setProjectError(null);
                }}
                placeholder="sqls"
                className="h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none transition-colors placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))] focus:ring-1 focus:ring-[hsl(var(--wb-accent)/0.35)]"
                disabled={isCreatingProject}
              />
              <div className="min-h-4 text-[11px] leading-4">
                {projectError ? (
                  <span className="text-red-400">{projectError}</span>
                ) : (
                  <span className="text-[hsl(var(--wb-text-muted))]">
                    Connections and introspection cache will be scoped to this project.
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
                  !normalizedProjectName ||
                  projectNameExists
                }
              >
                <Check size={13} />
                {isCreatingProject ? "Creating..." : "Create"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsMenuItem({
  icon: Icon,
  label,
  shortcut,
  suffix,
  active,
  trailing,
  mutedSuffix,
  onClick,
}: {
  icon?: typeof Settings;
  label: string;
  shortcut?: string;
  suffix?: string;
  active?: boolean;
  trailing?: boolean;
  mutedSuffix?: boolean;
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
        {Icon ? <Icon size={14} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="shrink-0 text-[12px] text-[hsl(var(--wb-text-muted))]">
          {shortcut}
        </span>
      )}
      {suffix && (
        <span
          className={`shrink-0 text-[12px] ${
            mutedSuffix
              ? "text-[hsl(var(--wb-text-muted))]"
              : "text-[hsl(var(--wb-text))]"
          }`}
        >
          {suffix}
        </span>
      )}
      {trailing && (
        <ChevronRight size={13} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
      )}
    </button>
  );
}

function SettingsMenuSeparator() {
  return <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />;
}
