import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/styles/utils";
import type { LargeTransferRequest } from "@/services/tauri/types";
import { useResumableTransfer } from "../hooks/useResumableTransfer";
import {
  transferDriverName,
  transferEndpointName,
  transferPhaseLabels,
} from "../model/largeTransferPolicy";
import { ResumableTransferReview } from "./ResumableTransferReview";

interface Props {
  open: boolean;
  projectId: string;
  request: LargeTransferRequest | null;
  onClose: () => void;
  onBack: () => void;
  onTransferred?: () => void;
  connectionNames?: Record<string, string>;
}

export function ResumableTransferDialog({
  open,
  projectId,
  request,
  onClose,
  onBack,
  onTransferred,
  connectionNames = {},
}: Props) {
  const controller = useResumableTransfer(open, projectId, onTransferred);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent layout="custom" className="flex max-h-[calc(100vh-32px)] w-[min(880px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 text-[12px]">
        <DialogHeader className="shrink-0 border-b border-border-subtle px-5 py-4 text-left">
          <DialogTitle>Full table transfer</DialogTitle>
          <DialogDescription>
            Copy all rows between saved native MySQL or PostgreSQL connections,
            or local SQLite files. Pause and resume saved jobs in this project.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <section
            className="space-y-3 border-b border-border-subtle px-5 py-4"
            aria-label="Prepare a new full transfer"
          >
            {request ? (
              <>
                <p className="break-all">
                  <strong>
                    {connectionNames[request.source.connectionId] ??
                      request.source.connectionId}{" "}
                    · {transferEndpointName(request.source)}
                  </strong>{" "}
                  →{" "}
                  <strong>
                    {connectionNames[request.target.connectionId] ??
                      request.target.connectionId}{" "}
                    · {transferEndpointName(request.target)}
                  </strong>{" "}
                  · {request.mode}
                </p>
                <p className="text-muted-foreground">
                  {request.source.driver !== "sqlite"
                    ? `Preparation saves a private snapshot of the selected ${transferDriverName(request.source.driver)} table.`
                    : "Preparation saves a private copy of the entire source database, including unselected tables."}{" "}
                  Target rows change only after you review, start and finish
                  copying the transfer. The row limit, schema restore and
                  identity options in the setup screen do not apply here.
                </p>
                {request.source.driver === "mysql" && (
                  <p className="text-muted-foreground">
                    MySQL requires version 8.0.22 or later, InnoDB tables and
                    permission to inspect target triggers.
                  </p>
                )}
                <Button
                  size="sm"
                  disabled={controller.busy}
                  onClick={() => void controller.prepare(request)}
                >
                  Prepare full snapshot
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                To prepare a new transfer, go back and select one table and an
                existing target using saved native MySQL, PostgreSQL or local
                SQLite connections. Your saved jobs remain available below.
              </p>
            )}
          </section>
          <div className="grid min-h-72 sm:grid-cols-[220px_minmax(0,1fr)]">
            <nav
              className="max-h-56 overflow-y-auto border-b border-border-subtle p-3 sm:sticky sm:top-0 sm:max-h-[calc(100vh-12rem)] sm:self-start sm:border-b-0 sm:border-r"
              aria-label="Saved full transfers"
            >
              <h3 className="mb-2 px-2 font-medium text-muted-foreground">
                Saved transfers
              </h3>
              {controller.loading && (
                <p role="status" className="px-2">
                  Loading transfers…
                </p>
              )}
              {!controller.loading && controller.jobs.length === 0 && (
                <p className="px-2 text-muted-foreground">
                  No saved transfers in this project.
                </p>
              )}
              {controller.jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  aria-pressed={controller.job?.id === job.id}
                  onClick={() => controller.selectJob(job.id)}
                  className={cn(
                    "mb-1 block w-full rounded px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    controller.job?.id === job.id && "bg-accent",
                  )}
                >
                  <span className="block truncate">
                    {job.source.table} → {job.target.table}
                  </span>
                  <span className="block text-muted-foreground">
                    {transferDriverName(job.source.driver)} ·{" "}
                    {transferPhaseLabels[job.phase]}
                  </span>
                  <time
                    className="block text-muted-foreground"
                    dateTime={new Date(job.createdAt).toISOString()}
                  >
                    {new Date(job.createdAt).toLocaleString()}
                  </time>
                </button>
              ))}
              {controller.hasMore && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={controller.busy}
                  onClick={() => void controller.loadMore()}
                >
                  Load older transfers
                </Button>
              )}
            </nav>
            <main className="min-w-0 space-y-3 px-5 py-4">
              {controller.error && (
                <p role="alert" className="break-words text-destructive">
                  {controller.error}
                </p>
              )}
              <ResumableTransferReview
                controller={controller}
                connectionNames={connectionNames}
              />
            </main>
          </div>
        </div>
        <DialogFooter className="shrink-0 items-center gap-3 border-t border-border-subtle px-5 py-3 sm:justify-between">
          <p className="text-muted-foreground">
            Jobs keep running while this app is open. After quitting, reopen
            this project's transfer dialog to resume.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" onClick={onBack}>
              Back to setup
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
