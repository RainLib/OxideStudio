import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actionEvents";
import type { WorkbenchSide } from "@/lib/appSettings";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/useProjectStore";
import { useProjectGitStore } from "@/store/useProjectGitStore";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useStartupProgress } from "@/startup/startupProgress";
import {
  Bell,
  ChevronRight,
  Database,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  MoreHorizontal,
  PanelRight,
  Pin,
  PinOff,
  Search,
  Sparkles,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

const TaskStatusCenter = lazy(() =>
  import("./TaskStatusCenter").then((module) => ({
    default: module.TaskStatusCenter,
  })),
);

interface WorkbenchTitleToolsProps {
  databaseExplorerOpen: boolean;
  databaseExplorerSide: WorkbenchSide;
  assistantOpen: boolean;
  assistantSide: WorkbenchSide;
  projectFilesOpen: boolean;
  projectFilesSide: WorkbenchSide;
  commitOpen: boolean;
  commitPinned: boolean;
  versionControlOpen: boolean;
  versionControlPinned: boolean;
  onToggleDatabaseExplorer: () => void;
  onToggleAssistant: () => void;
  onToggleFiles: () => void;
  onToggleCommit: () => void;
  onToggleVersionControl: () => void;
  onSetCommitPinned: (pinned: boolean) => void;
  onSetVersionControlPinned: (pinned: boolean) => void;
}

export function WorkbenchTitleTools({
  databaseExplorerOpen,
  databaseExplorerSide,
  assistantOpen,
  assistantSide,
  projectFilesOpen,
  projectFilesSide,
  commitOpen,
  commitPinned,
  versionControlOpen,
  versionControlPinned,
  onToggleDatabaseExplorer,
  onToggleAssistant,
  onToggleFiles,
  onToggleCommit,
  onToggleVersionControl,
  onSetCommitPinned,
  onSetVersionControlPinned,
}: WorkbenchTitleToolsProps) {
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) =>
    state.projects.find((project) => project.id === state.activeProjectId),
  );
  const gitSession = useProjectGitStore((state) => state.sessions[activeProjectId]);
  const ensureGitSession = useProjectGitStore((state) => state.ensureSession);
  const refreshGit = useProjectGitStore((state) => state.refresh);
  const repository = gitSession?.repository;
  useEffect(() => {
    const rootPath = activeProject?.root_path || null;
    ensureGitSession(activeProjectId, rootPath);
    if (rootPath && activeProject?.origin !== "managed") {
      void refreshGit(activeProjectId, rootPath);
    }
  }, [activeProject?.origin, activeProject?.root_path, activeProjectId, ensureGitSession, refreshGit]);
  return (
    <div className="flex h-7 items-center gap-0.5" aria-label="Tool windows">
      <button
        type="button"
        className="wb-title-tool-button"
        data-active={databaseExplorerOpen}
        aria-pressed={databaseExplorerOpen}
        onClick={onToggleDatabaseExplorer}
        title={`Toggle Database Explorer (${databaseExplorerSide})`}
      >
        <Database size={15} />
      </button>
      <button
        type="button"
        className="wb-title-tool-button"
        data-active={assistantOpen}
        aria-pressed={assistantOpen}
        onClick={onToggleAssistant}
        title={`Toggle AI Assistant (${assistantSide})`}
      >
        <Sparkles size={15} />
      </button>
      <button
        type="button"
        className="wb-title-tool-button"
        data-active={projectFilesOpen}
        aria-pressed={projectFilesOpen}
        onClick={onToggleFiles}
        title={`Toggle Project Files (${projectFilesSide})`}
      >
        <FolderTree size={15} />
      </button>
      {commitPinned && (
        <PinnedTitleTool
          label="Commit"
          Icon={GitCommitHorizontal}
          open={commitOpen}
          status={`${repository?.files.length ?? 0} changes`}
          onToggle={onToggleCommit}
          onUnpin={() => onSetCommitPinned(false)}
        />
      )}
      {versionControlPinned && (
        <PinnedTitleTool
          label="Version Control"
          Icon={GitBranch}
          open={versionControlOpen}
          status={repositoryStatus(repository)}
          onToggle={onToggleVersionControl}
          onUnpin={() => onSetVersionControlPinned(false)}
        />
      )}
      {(!commitPinned || !versionControlPinned) && <Popover
        open={moreToolsOpen}
        onOpenChange={setMoreToolsOpen}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="wb-title-tool-button"
            data-active={
              (commitOpen && !commitPinned) ||
              (versionControlOpen && !versionControlPinned)
            }
            aria-label="More tool windows"
            title="More tool windows"
          >
            <MoreHorizontal size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          sideOffset={6}
          className="w-[260px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[11px] shadow-[0_16px_38px_rgba(0,0,0,0.42)]"
        >
          {!commitPinned && (
            <MoreTitleTool
              label="Commit"
              Icon={GitCommitHorizontal}
              open={commitOpen}
              status={`${repository?.files.length ?? 0}`}
              onToggle={onToggleCommit}
              onPin={() => {
                onSetCommitPinned(true);
                setMoreToolsOpen(false);
              }}
            />
          )}
          {!versionControlPinned && (
            <MoreTitleTool
              label="Version Control"
              Icon={GitBranch}
              open={versionControlOpen}
              status={repositoryStatus(repository)}
              onToggle={onToggleVersionControl}
              onPin={() => {
                onSetVersionControlPinned(true);
                setMoreToolsOpen(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>}
    </div>
  );
}

function MoreTitleTool({
  label,
  Icon,
  open,
  status,
  onToggle,
  onPin,
}: {
  label: string;
  Icon: LucideIcon;
  open: boolean;
  status: string;
  onToggle: () => void;
  onPin: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex h-8 w-full items-center rounded-[3px] hover:bg-[hsl(var(--wb-hover))] focus-within:bg-[hsl(var(--wb-hover))]",
        open && "bg-[hsl(var(--wb-active))]",
      )}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left"
        onClick={onToggle}
      >
        <Icon size={12} />
        <span className="min-w-0 flex-1">{label}</span>
        <span className="max-w-28 truncate font-mono text-[9px] tabular-nums text-[hsl(var(--wb-text-muted))]">
          {status}
        </span>
      </button>
      <button
        type="button"
        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[hsl(var(--wb-text-muted))] opacity-0 hover:bg-[hsl(var(--wb-active-strong))] hover:text-[hsl(var(--wb-text))] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={`Pin ${label} to title bar`}
        title={`Pin ${label} to title bar`}
        onClick={onPin}
      >
        <Pin size={11} />
      </button>
    </div>
  );
}

function PinnedTitleTool({
  label,
  Icon,
  open,
  status,
  onToggle,
  onUnpin,
}: {
  label: string;
  Icon: LucideIcon;
  open: boolean;
  status: string;
  onToggle: () => void;
  onUnpin: () => void;
}) {
  return (
    <div className="group relative flex h-7 items-center">
      <button
        type="button"
        className="wb-title-tool-button"
        data-active={open}
        aria-pressed={open}
        aria-label={`Toggle ${label}`}
        title={`Toggle ${label} · ${status}`}
        onClick={onToggle}
      >
        <Icon size={15} />
      </button>
      <button
        type="button"
        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text-muted))] opacity-0 shadow-sm hover:text-[hsl(var(--wb-text))] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        aria-label={`Unpin ${label} from title bar`}
        title={`Unpin ${label}`}
        onClick={onUnpin}
      >
        <PinOff size={9} />
      </button>
    </div>
  );
}

function repositoryStatus(
  repository:
    | {
        branch?: string | null;
        ahead: number;
        behind: number;
      }
    | undefined,
) {
  if (!repository) return "No repository";
  return `${repository.branch || "Detached HEAD"}${
    repository.ahead > 0 ? ` ↑${repository.ahead}` : ""
  }${repository.behind > 0 ? ` ↓${repository.behind}` : ""}`;
}

export function WorkbenchGlobalTools() {
  return (
    <button
      type="button"
      className="wb-icon-button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE))
      }
      title="Search Everywhere"
      aria-label="Search Everywhere"
    >
      <Search size={15} />
    </button>
  );
}

interface WorkbenchStatusBarProps {
  activeConnectionName?: string;
  currentSchema?: string | null;
  activeTabTitle?: string;
  isIntrospecting: boolean;
  secondaryPanelOpen: boolean;
  onToggleSecondaryPanel: () => void;
}

export function WorkbenchStatusBar({
  activeConnectionName,
  currentSchema,
  activeTabTitle,
  isIntrospecting,
  secondaryPanelOpen,
  onToggleSecondaryPanel,
}: WorkbenchStatusBarProps) {
  const activeProjectName = useProjectStore((state) => state.activeProjectName);
  const startupProgress = useStartupProgress();
  const hasEditorContext = Boolean(activeTabTitle);

  return (
    <footer
      className="wb-statusbar z-30 flex w-full items-center transition-colors duration-200"
      aria-label="Workbench status"
    >
      <div className="flex min-w-0 items-center gap-1 px-2">
        {hasEditorContext ? (
          <>
            <span className="shrink-0">Database</span>
            {activeConnectionName && (
              <>
                <ChevronRight size={11} className="shrink-0 wb-muted" />
                <span className="truncate">{activeConnectionName}</span>
              </>
            )}
            {currentSchema && (
              <>
                <ChevronRight size={11} className="shrink-0 wb-muted" />
                <span className="truncate">{currentSchema}</span>
              </>
            )}
            <ChevronRight size={11} className="shrink-0 wb-muted" />
            <span className="truncate">{activeTabTitle}</span>
          </>
        ) : (
          <>
            <SquareTerminal
              size={12}
              className="shrink-0 text-[hsl(var(--wb-accent))]"
            />
            <span className="truncate">{activeProjectName || "sqls"}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex h-full min-w-0 items-center overflow-hidden">
        {startupProgress.active ? (
          <div
            className="hidden h-full items-center gap-2 px-2 text-[11px] text-[hsl(var(--wb-text-muted))] sm:flex"
            role="status"
            aria-live="polite"
          >
            <span className="max-w-52 truncate whitespace-nowrap">
              {startupProgress.label}
            </span>
            <span
              className="wb-progress-track"
              role="progressbar"
              aria-label={startupProgress.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(startupProgress.progress * 100)}
            >
              <span
                className="wb-progress-bar wb-progress-bar-determinate"
                style={{
                  transform: `scaleX(${startupProgress.progress})`,
                }}
              />
            </span>
          </div>
        ) : isIntrospecting ? (
          <div className="hidden h-full items-center gap-2 px-2 text-[11px] text-[hsl(var(--wb-text-muted))] sm:flex">
            <span className="whitespace-nowrap">Introspecting metadata</span>
            <span className="wb-progress-track">
              <span className="wb-progress-bar" />
            </span>
          </div>
        ) : null}
        <DeferredTaskStatusCenter />
        <div
          id="status-bar-slot"
          className="flex h-full min-w-0 items-center overflow-hidden"
        />
        <button
          type="button"
          className={cn(
            "flex h-full w-7 shrink-0 items-center justify-center text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
            secondaryPanelOpen && "text-[hsl(var(--wb-accent))]",
          )}
          onClick={onToggleSecondaryPanel}
          aria-pressed={secondaryPanelOpen}
          title="Toggle Secondary Panel"
        >
          <PanelRight size={12} />
        </button>
      </div>
    </footer>
  );
}

function DeferredTaskStatusCenter() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setEnabled(true), {
        timeout: 1_000,
      });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setEnabled(true), 750);
    return () => window.clearTimeout(handle);
  }, []);

  if (!enabled) {
    return (
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center text-[hsl(var(--wb-text-muted))]"
        title="Background Tasks"
        aria-label="Background Tasks"
        onPointerEnter={() => setEnabled(true)}
        onFocus={() => setEnabled(true)}
      >
        <Bell size={12} />
      </button>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-full w-7 items-center justify-center text-[hsl(var(--wb-text-muted))]">
          <Bell size={12} />
        </div>
      }
    >
      <TaskStatusCenter />
    </Suspense>
  );
}
