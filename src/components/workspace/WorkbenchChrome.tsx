import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actionEvents";
import type { WorkbenchSide } from "@/lib/appSettings";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/useProjectStore";
import { useStartupProgress } from "@/startup/startupProgress";
import {
  Bell,
  ChevronRight,
  Database,
  FolderTree,
  PanelRight,
  Search,
  Sparkles,
  SquareTerminal,
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
  secondaryPanelOpen: boolean;
  secondaryPanelView: "assistant" | "files";
  assistantSide: WorkbenchSide;
  onToggleDatabaseExplorer: () => void;
  onToggleAssistant: () => void;
  onToggleFiles: () => void;
}

export function WorkbenchTitleTools({
  databaseExplorerOpen,
  databaseExplorerSide,
  secondaryPanelOpen,
  secondaryPanelView,
  assistantSide,
  onToggleDatabaseExplorer,
  onToggleAssistant,
  onToggleFiles,
}: WorkbenchTitleToolsProps) {
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
        data-active={secondaryPanelOpen && secondaryPanelView === "assistant"}
        aria-pressed={secondaryPanelOpen && secondaryPanelView === "assistant"}
        onClick={onToggleAssistant}
        title={`Toggle AI Assistant (${assistantSide})`}
      >
        <Sparkles size={15} />
      </button>
      <button
        type="button"
        className="wb-title-tool-button"
        data-active={secondaryPanelOpen && secondaryPanelView === "files"}
        aria-pressed={secondaryPanelOpen && secondaryPanelView === "files"}
        onClick={onToggleFiles}
        title={`Toggle Project Files (${assistantSide})`}
      >
        <FolderTree size={15} />
      </button>
    </div>
  );
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
