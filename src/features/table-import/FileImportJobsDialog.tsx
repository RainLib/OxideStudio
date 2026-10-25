import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResumableTransferReview } from "@/features/table-transfer/ui/ResumableTransferReview";
import { transferEndpointName, transferPhaseLabels } from "@/features/table-transfer/model/largeTransferPolicy";
import { useConnectionStore } from "@/store/useConnectionStore";
import { cn } from "@/styles/utils";
import { useFileImportNavigation } from "./fileImportNavigation";
import { useFileImportJobs } from "./useFileImportJobs";
import "./fileImportJobs.css";

const preparationLabels = {
  copying: "Saving private source copy",
  inspecting: "Inspecting source",
  normalizing: "Preparing normalized rows",
  ready: "Finishing handoff",
};

export function FileImportJobsDialog({ projectId }: { projectId: string }) {
  const navigation = useFileImportNavigation();
  const open = navigation.projectId === projectId;
  const state = useFileImportJobs(open, projectId);
  const { controller, preparation } = state;
  const connections = useConnectionStore(store => store.connections);
  const names = Object.fromEntries(connections.map(connection => [connection.id, connection.name]));
  useEffect(() => {
    const request = navigation.pending;
    if (open && request?.projectId === projectId && navigation.take(request)) {
      void state.prepare(request);
    }
  }, [open, projectId, navigation.pending]);
  const displayedJobs = controller.jobs.filter(job => job.reviewReady || !state.preparations.some(prep => prep.id === job.id));
  const loading = controller.loading || state.preparationsLoading;
  return (
    <Dialog open={open} onOpenChange={value => { if (!value) navigation.close(); }}>
      <DialogContent layout="custom" className="file-import-jobs flex max-h-[calc(100vh-32px)] w-[min(880px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden p-0 text-[12px]">
        <DialogHeader className="shrink-0 border-b border-border-subtle px-5 py-4 text-left">
          <DialogTitle>Resumable file imports</DialogTitle>
          <DialogDescription>
            Prepare CSV, JSON or XLSX privately, then review before writing to an existing local SQLite table.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-72 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
          <nav aria-label="Saved file imports" className="overflow-y-auto border-r border-border-subtle p-3">
            <h3 className="mb-2 px-2 font-medium text-muted-foreground">This project's imports</h3>
            {loading && <p role="status" className="px-2">Loading imports…</p>}
            {!loading && !state.preparations.length && !displayedJobs.length && <p className="px-2 text-muted-foreground">No saved imports. Choose Import on a local SQLite table to prepare a file.</p>}
            {state.preparations.map(prep => (
              <button key={prep.id} type="button" aria-pressed={preparation?.id === prep.id}
                className={cn("mb-1 block w-full rounded px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", preparation?.id === prep.id && "bg-accent")}
                onClick={() => state.selectPreparation(prep.id)}>
                <span className="block break-words">{prep.display?.fileName ?? `Preparation ${prep.id.slice(0, 8)}`}</span>
                <span className="block text-muted-foreground">{prep.active ? preparationLabels[prep.phase] : "Saved preparation"}</span>
              </button>
            ))}
            {state.hasMorePreparations && <Button size="sm" variant="ghost" onClick={state.loadMorePreparations}>Load more preparations</Button>}
            {displayedJobs.map(job => (
              <button key={job.id} type="button" aria-pressed={!preparation && controller.job?.id === job.id}
                className={cn("mb-1 block w-full rounded px-2 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", !preparation && controller.job?.id === job.id && "bg-accent")}
                onClick={() => state.selectJob(job.id)}>
                <span className="block break-words">{transferEndpointName(job.target)}</span>
                <span className="block text-muted-foreground">{transferPhaseLabels[job.phase]}</span>
                <time className="block text-muted-foreground" dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleString()}</time>
              </button>
            ))}
            {controller.hasMore && <Button size="sm" variant="ghost" disabled={controller.busy} onClick={() => void controller.loadMore()}>Load older imports</Button>}
          </nav>
          <div className="min-w-0 overflow-y-auto px-5 py-4">
            {(state.error || controller.error) && <p role="alert" className="mb-4 break-words text-[hsl(var(--wb-error-text))]">{state.error || controller.error}</p>}
            {state.notice && <p role="status" className="mb-4 text-muted-foreground">{state.notice}</p>}
            {preparation ? (
              <section aria-label="Selected preparation" className="space-y-4">
                <h3 role="status" className="font-semibold">{preparation.active ? preparationLabels[preparation.phase] : "Saved preparation"}</h3>
                {preparation.display && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                  <dt className="text-muted-foreground">File</dt><dd className="break-all">{preparation.display.fileName} · {preparation.display.format.toUpperCase()}</dd>
                  <dt className="text-muted-foreground">Target</dt><dd className="break-all">{names[preparation.display.connectionId] ?? preparation.display.connectionId} · {preparation.display.schema}.{preparation.display.table}</dd>
                  <dt className="text-muted-foreground">Write mode</dt><dd>{preparation.display.mode === "truncate" ? "Replace all rows" : "Append rows"}</dd>
                </dl>}
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 tabular-nums">
                  <dt className="text-muted-foreground">Source bytes recorded</dt><dd>{preparation.sourceBytes.toLocaleString()}</dd>
                  <dt className="text-muted-foreground">Rows recorded</dt><dd>{preparation.normalizedRows.toLocaleString()}</dd>
                </dl>
                <p className="text-muted-foreground">Target rows have not changed. Preparation saves a private copy and validates the full source. Publication requires a separate review and typed confirmation.</p>
                {!preparation.active && <p className="text-muted-foreground">Continue rechecks the saved source and target. Keep the original source available if its private copy was interrupted. Discard removes only this preparation's private files.</p>}
                <div className="flex flex-wrap gap-2">
                  {preparation.active ? <Button size="sm" variant="outline" onClick={() => void state.stopPreparation()}>Cancel preparation</Button> : <>
                    <Button size="sm" disabled={!!state.action || controller.busy} onClick={() => void state.resumePreparation()}>{state.action === "resume" ? "Continuing…" : "Continue preparation"}</Button>
                    <Button size="sm" variant="outline" disabled={!!state.action || controller.busy} onClick={() => void state.discardPreparation()}>Discard preparation</Button>
                  </>}
                </div>
                {preparation.active && <p className="text-muted-foreground">Cancel removes private preparation data. Closing this dialog keeps work running while the app is open.</p>}
              </section>
            ) : state.preparing ? <p role="status" className="py-8 text-muted-foreground">Starting preparation…</p> : controller.job ? <ResumableTransferReview controller={controller} connectionNames={names} /> : <p role="status" className="py-8 text-muted-foreground">Select a saved import to review its progress and available actions.</p>}
          </div>
        </div>
        <DialogFooter className="shrink-0 items-center border-t border-border-subtle px-5 py-3 sm:justify-between">
          <p className="max-w-[65ch] text-muted-foreground">After quitting, reopen Background Tasks → File imports to continue. Refresh the table after publication; unsaved edits are kept.</p>
          <Button size="sm" variant="outline" onClick={navigation.close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
