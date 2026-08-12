import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CircleArrowDown,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUpdateStore, type AppUpdateStatus } from "@/store/useUpdateStore";

interface UpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function formatReleaseDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function ReleaseNotes({ body }: { body: string | null }) {
  if (!body?.trim()) {
    return (
      <p className="text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        This release does not include additional notes.
      </p>
    );
  }

  return (
    <div className="space-y-1.5 text-[12px] leading-5 text-[hsl(var(--wb-text))]">
      {body.split(/\r?\n/).map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;

        const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
        if (heading) {
          return (
            <h3 key={index} className="pt-1 text-[12px] font-semibold">
              {heading[1]}
            </h3>
          );
        }

        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <div key={index} className="flex gap-2 pl-0.5">
              <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--wb-text-muted))]" />
              <span>{bullet[1]}</span>
            </div>
          );
        }

        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

function StatusMessage({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-52 items-center justify-center px-8 py-12 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center text-[hsl(var(--wb-text-muted))]">
          {icon}
        </div>
        <h3 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
          {title}
        </h3>
        <div className="mt-1 text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
          {children}
        </div>
      </div>
    </div>
  );
}

function actionLabel(status: AppUpdateStatus) {
  if (status === "downloading") return "Downloading...";
  if (status === "downloaded") return "Install and Restart";
  if (status === "installing") return "Installing...";
  return "Download Update";
}

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps) {
  const {
    currentVersion,
    update,
    status,
    downloadedBytes,
    totalBytes,
    error,
    checkForUpdates,
    downloadUpdate,
    installAndRestart,
    ignoreAvailableVersion,
    clearError,
  } = useUpdateStore();

  const progress =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;
  const releaseDate = formatReleaseDate(update?.date ?? null);
  const hasUpdate =
    status === "available" ||
    status === "downloading" ||
    status === "downloaded" ||
    status === "installing";

  const runPrimaryAction = () => {
    if (status === "available") void downloadUpdate();
    if (status === "downloaded") void installAndRestart();
  };

  const ignoreVersion = () => {
    ignoreAvailableVersion();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) clearError();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[560px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_20px_54px_rgba(0,0,0,0.48)] [&>button]:right-3 [&>button]:top-3 [&>button]:text-[hsl(var(--wb-text-muted))]">
        <DialogHeader className="space-y-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 pr-11 text-left">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-accent))]">
              <CircleArrowDown size={16} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[13px] font-semibold leading-5 tracking-normal">
                OxideStudio Update
              </DialogTitle>
              <DialogDescription className="text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {update
                  ? `Version ${update.version} is available. You have ${update.currentVersion}.`
                  : `Installed version ${currentVersion || "unknown"}.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-[276px]">
          {status === "checking" && (
            <StatusMessage
              icon={<LoaderCircle size={24} className="animate-spin" />}
              title="Checking for updates"
            >
              Contacting the OxideStudio release service.
            </StatusMessage>
          )}

          {status === "up-to-date" && (
            <StatusMessage icon={<Check size={24} />} title="OxideStudio is up to date">
              Version {currentVersion} is the latest available release.
            </StatusMessage>
          )}

          {status === "unsupported" && (
            <StatusMessage
              icon={<CircleArrowDown size={24} />}
              title="Desktop updates are unavailable"
            >
              Update checks are only supported by the installed desktop application.
            </StatusMessage>
          )}

          {status === "error" && (
            <StatusMessage icon={<AlertTriangle size={24} />} title="Update check failed">
              {error || "The update service returned an unexpected error."}
            </StatusMessage>
          )}

          {(status === "idle" || hasUpdate) && update && (
            <div className="flex h-[276px] flex-col">
              <div className="flex items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-4 py-2 text-[11px]">
                <span className="font-semibold text-[hsl(var(--wb-text))]">
                  What&apos;s new in {update.version}
                </span>
                {releaseDate && (
                  <span className="text-[hsl(var(--wb-text-muted))]">
                    {releaseDate}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <ReleaseNotes body={update.body} />
              </div>
              {(status === "downloading" || status === "downloaded") && (
                <div className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-[hsl(var(--wb-text-muted))]">
                    <span>
                      {status === "downloaded" ? "Ready to install" : "Downloading update"}
                    </span>
                    <span>
                      {progress !== null
                        ? `${progress}% · ${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes ?? 0)}`
                        : formatBytes(downloadedBytes)}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-[2px] bg-[hsl(var(--wb-border))]">
                    <div
                      className={`h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-150 ${
                        progress === null && status === "downloading"
                          ? "w-1/3 animate-pulse"
                          : ""
                      }`}
                      style={progress === null ? undefined : { width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && status !== "error" && (
          <div className="flex items-start gap-2 border-t border-red-400/20 bg-red-400/5 px-4 py-2 text-[11px] leading-4 text-red-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-4 py-3 sm:space-x-0">
          {(status === "up-to-date" || status === "error") && (
            <button
              type="button"
              className="wb-text-button h-7 gap-1.5 px-3"
              onClick={() => void checkForUpdates({ force: true })}
            >
              <RefreshCw size={13} />
              Check Again
            </button>
          )}
          {status === "available" && update && (
            <button
              type="button"
              className="wb-text-button h-7 px-3"
              onClick={ignoreVersion}
            >
              Ignore {update.version}
            </button>
          )}
          <button
            type="button"
            className="wb-text-button h-7 px-3"
            onClick={() => onOpenChange(false)}
            disabled={status === "installing"}
          >
            {hasUpdate ? "Later" : "Close"}
          </button>
          {hasUpdate && (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-[hsl(var(--wb-accent))] px-3 text-[12px] font-medium text-[hsl(var(--wb-accent-foreground))] transition-colors hover:brightness-110 disabled:pointer-events-none disabled:opacity-55"
              onClick={runPrimaryAction}
              disabled={status === "downloading" || status === "installing"}
            >
              {status === "downloaded" || status === "installing" ? (
                <RotateCw size={13} className={status === "installing" ? "animate-spin" : ""} />
              ) : (
                <Download size={13} />
              )}
              {actionLabel(status)}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

