import { EnterpriseAccountMenu } from "@/components/EnterpriseAccountMenu";
import type { SettingsSection } from "@/components/settings/SettingsDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ProjectSwitcher } from "@/features/projects/ui/ProjectSwitcher";
import { SettingsMenuItem } from "@/features/workbench/ui/SettingsMenuItem";
import { useAppUpdatePolling } from "@/hooks/useAppUpdatePolling";
import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actionEvents";
import { useUpdateStore } from "@/store/useUpdateStore";
import {
  AppWindow,
  CircleArrowDown,
  FileJson2,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  Settings,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

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

  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  const updateStatus = useUpdateStore((state) => state.status);
  const availableUpdate = useUpdateStore((state) => state.update);
  const updateDownloadedBytes = useUpdateStore(
    (state) => state.downloadedBytes,
  );
  const updateTotalBytes = useUpdateStore((state) => state.totalBytes);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const updateNeedsBackupRecovery = useUpdateStore((state) => state.nativeInstallation?.recoveryRequired === true);
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

  const openUpdateDialog = () => {
    setSettingsMenuOpen(false);
    setUpdateDialogOpen(true);
    if (
      !updateNeedsBackupRecovery &&
      (updateStatus === "idle" ||
        updateStatus === "up-to-date" ||
        updateStatus === "error" ||
        updateStatus === "unsupported")
    ) {
      void checkForUpdates({ force: true });
    }
  };

  const updateMenuLabel = (() => {
    if (updateNeedsBackupRecovery) return "Resume backups after update...";
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
    if (updateStatus === "preparing") return "Waiting for backups...";
    if (updateStatus === "installing") return "Installing update...";
    if (updateStatus === "restart-required") return "Restart updated application...";
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
    updateStatus === "available" || updateStatus === "downloaded" || updateStatus === "restart-required" || updateNeedsBackupRecovery;
  const showUpdateStatusButton =
    updateStatus === "available" ||
    updateStatus === "downloading" ||
    updateStatus === "downloaded" || updateStatus === "preparing" || updateStatus === "installing" || updateStatus === "restart-required" || updateNeedsBackupRecovery;
  const updateProgress =
    updateStatus === "downloading" && updateTotalBytes && updateTotalBytes > 0
      ? Math.min(1, updateDownloadedBytes / updateTotalBytes)
      : null;

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
          <ProjectSwitcher />
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
              className="w-[238px] p-1 text-[13px]"
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
    "drivers",
    "ai",
  ].includes(value);
}
