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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatKeybinding } from "@/lib/keybindings";
import type { WorkbenchActionId } from "@/lib/actions";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useStartupProgress } from "@/startup/startupProgress";
import {
  Bell,
  ChevronRight,
  Database,
  FolderTree,
  Library,
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
import {
  cloneElement,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
} from "react";

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
  sqlLibraryOpen: boolean;
  sqlLibrarySide: WorkbenchSide;
  commitOpen: boolean;
  commitPinned: boolean;
  versionControlOpen: boolean;
  versionControlPinned: boolean;
  onToggleDatabaseExplorer: () => void;
  onToggleAssistant: () => void;
  onToggleFiles: () => void;
  onToggleSqlLibrary: () => void;
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
  sqlLibraryOpen,
  sqlLibrarySide,
  commitOpen,
  commitPinned,
  versionControlOpen,
  versionControlPinned,
  onToggleDatabaseExplorer,
  onToggleAssistant,
  onToggleFiles,
  onToggleSqlLibrary,
  onToggleCommit,
  onToggleVersionControl,
  onSetCommitPinned,
  onSetVersionControlPinned,
}: WorkbenchTitleToolsProps) {
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [moreTooltipOpen, setMoreTooltipOpen] = useState(false);
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
    <TooltipProvider
      delayDuration={350}
      skipDelayDuration={120}
      disableHoverableContent
    >
      <div className="flex h-7 items-center gap-0.5" aria-label="Tool windows">
        <WorkbenchToolTooltip
          label="Database Explorer"
          detail={`${sideLabel(databaseExplorerSide)} tool window`}
          actionId="workbench.toggleDatabaseExplorer"
        >
          <button
            type="button"
            className="wb-title-tool-button"
            data-active={databaseExplorerOpen}
            aria-pressed={databaseExplorerOpen}
            aria-label="Toggle Database Explorer"
            onClick={onToggleDatabaseExplorer}
          >
            <Database size={15} />
          </button>
        </WorkbenchToolTooltip>
        <WorkbenchToolTooltip
          label="AI Assistant"
          detail={`${sideLabel(assistantSide)} tool window`}
          actionId="workbench.toggleAssistant"
        >
          <button
            type="button"
            className="wb-title-tool-button"
            data-active={assistantOpen}
            aria-pressed={assistantOpen}
            aria-label="Toggle AI Assistant"
            onClick={onToggleAssistant}
          >
            <Sparkles size={15} />
          </button>
        </WorkbenchToolTooltip>
        <WorkbenchToolTooltip
          label="Project Files"
          detail={`${sideLabel(projectFilesSide)} tool window`}
          actionId="workbench.openProjectFiles"
        >
          <button
            type="button"
            className="wb-title-tool-button"
            data-active={projectFilesOpen}
            aria-pressed={projectFilesOpen}
            aria-label="Toggle Project Files"
            onClick={onToggleFiles}
          >
            <FolderTree size={15} />
          </button>
        </WorkbenchToolTooltip>
        <WorkbenchToolTooltip
          label="SQL Library"
          detail={`${sideLabel(sqlLibrarySide)} tool window`}
        >
          <button
            type="button"
            className="wb-title-tool-button"
            data-active={sqlLibraryOpen}
            aria-pressed={sqlLibraryOpen}
            aria-label="Toggle SQL Library"
            onClick={onToggleSqlLibrary}
          >
            <Library size={15} />
          </button>
        </WorkbenchToolTooltip>
        {commitPinned && (
          <PinnedTitleTool
            label="Commit"
            Icon={GitCommitHorizontal}
            open={commitOpen}
            status={`${repository?.files.length ?? 0} changes`}
            shortcutActionId="workbench.toggleCommit"
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
            shortcutActionId="workbench.toggleVersionControl"
            onToggle={onToggleVersionControl}
            onUnpin={() => onSetVersionControlPinned(false)}
          />
        )}
        {(!commitPinned || !versionControlPinned) && (
          <Popover
            open={moreToolsOpen}
            onOpenChange={(open) => {
              setMoreToolsOpen(open);
              if (open) setMoreTooltipOpen(false);
            }}
          >
            <Tooltip open={moreTooltipOpen} onOpenChange={setMoreTooltipOpen}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="wb-title-tool-button"
                    data-active={
                      (commitOpen && !commitPinned) ||
                      (versionControlOpen && !versionControlPinned)
                    }
                    aria-label="More tool windows"
                    onPointerLeave={() => setMoreTooltipOpen(false)}
                    onPointerDown={() => setMoreTooltipOpen(false)}
                    onBlur={() => setMoreTooltipOpen(false)}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={7}
                className="px-2.5 py-2 text-[11px]"
              >
                <div className="font-medium leading-none">More tool windows</div>
                <div className="mt-1 text-[9px] leading-none text-[hsl(var(--wb-text-muted))]">
                  Open or pin additional tools
                </div>
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="center"
              sideOffset={6}
              className="w-[260px] p-1 text-[11px]"
            >
              {!commitPinned && (
                <MoreTitleTool
                  label="Commit"
                  Icon={GitCommitHorizontal}
                  open={commitOpen}
                  status={`${repository?.files.length ?? 0}`}
                  shortcutActionId="workbench.toggleCommit"
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
                  shortcutActionId="workbench.toggleVersionControl"
                  onToggle={onToggleVersionControl}
                  onPin={() => {
                    onSetVersionControlPinned(true);
                    setMoreToolsOpen(false);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </TooltipProvider>
  );
}

function sideLabel(side: WorkbenchSide) {
  return side === "left" ? "Left" : "Right";
}

function platformShortcut(binding: string) {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/iu.test(navigator.platform);
  return formatKeybinding(binding).replace("⌘/Ctrl", isMac ? "⌘" : "Ctrl");
}

function ShortcutBadge({
  actionId,
  showUnassigned = false,
}: {
  actionId?: WorkbenchActionId;
  showUnassigned?: boolean;
}) {
  const binding = useSettingsStore((state) =>
    actionId ? state.settings.keymap[actionId]?.[0] || null : null,
  );
  if (!binding && !showUnassigned) return null;
  return (
    <kbd
      className={cn(
        "inline-flex h-[19px] shrink-0 items-center rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-active))] px-1.5 font-mono text-[9px] font-medium leading-none tracking-[0.02em] text-[hsl(var(--wb-text-muted))] shadow-[inset_0_1px_0_hsl(var(--wb-text)/0.04)]",
        !binding && "font-sans tracking-normal",
      )}
      data-workbench-shortcut={actionId}
    >
      {binding ? platformShortcut(binding) : "Unassigned"}
    </kbd>
  );
}

function WorkbenchToolTooltip({
  label,
  detail,
  actionId,
  children,
}: {
  label: string;
  detail: string;
  actionId?: WorkbenchActionId;
  children: ReactElement<ComponentPropsWithoutRef<"button">>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = cloneElement(children, {
    onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => {
      children.props.onPointerLeave?.(event);
      setOpen(false);
    },
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      children.props.onPointerDown?.(event);
      setOpen(false);
    },
    onBlur: (event: FocusEvent<HTMLButtonElement>) => {
      children.props.onBlur?.(event);
      setOpen(false);
    },
  });

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        key={label}
        side="bottom"
        align="center"
        sideOffset={7}
        collisionPadding={8}
        className="min-w-[180px] px-2.5 py-2 text-[11px]"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium leading-none">{label}</span>
          <ShortcutBadge
            actionId={actionId}
            showUnassigned={Boolean(actionId)}
          />
        </div>
        <div className="mt-1 text-[9px] leading-none text-[hsl(var(--wb-text-muted))]">
          {detail}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function MoreTitleTool({
  label,
  Icon,
  open,
  status,
  shortcutActionId,
  onToggle,
  onPin,
}: {
  label: string;
  Icon: LucideIcon;
  open: boolean;
  status: string;
  shortcutActionId: WorkbenchActionId;
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
        <span className="max-w-20 truncate font-mono text-[9px] tabular-nums text-[hsl(var(--wb-text-muted))]">
          {status}
        </span>
        <ShortcutBadge actionId={shortcutActionId} />
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
  shortcutActionId,
  onToggle,
  onUnpin,
}: {
  label: string;
  Icon: LucideIcon;
  open: boolean;
  status: string;
  shortcutActionId: WorkbenchActionId;
  onToggle: () => void;
  onUnpin: () => void;
}) {
  return (
    <div className="group relative flex h-7 items-center">
      <WorkbenchToolTooltip
        label={label}
        detail={status}
        actionId={shortcutActionId}
      >
        <button
          type="button"
          className="wb-title-tool-button"
          data-active={open}
          aria-pressed={open}
          aria-label={`Toggle ${label}`}
          onClick={onToggle}
        >
          <Icon size={15} />
        </button>
      </WorkbenchToolTooltip>
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
    <TooltipProvider
      delayDuration={350}
      skipDelayDuration={120}
      disableHoverableContent
    >
      <WorkbenchToolTooltip
        label="Search Everywhere"
        detail="Open the command palette"
        actionId="commandPalette.open"
      >
        <button
          type="button"
          className="wb-icon-button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE))
          }
          aria-label="Search Everywhere"
        >
          <Search size={15} />
        </button>
      </WorkbenchToolTooltip>
    </TooltipProvider>
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
