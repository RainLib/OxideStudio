import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { useResumableTransfer } from "../hooks/useResumableTransfer";
import {
  transferIssue,
  transferEndpointName,
  transferPhaseLabels,
} from "../model/largeTransferPolicy";

export function ResumableTransferReview({
  controller,
  connectionNames = {},
}: {
  controller: Pick<ReturnType<typeof useResumableTransfer>,
    "job" | "review" | "confirmation" | "setConfirmation" | "busy" |
    "requestedAction" | "reloadReview" | "start" | "requestAction">;
  connectionNames?: Record<string, string>;
}) {
  const { job, review, confirmation, setConfirmation, busy, requestedAction } =
    controller;
  if (!job)
    return (
      <p className="py-8 text-muted-foreground">
        Choose a saved transfer, or prepare a snapshot above.
      </p>
    );
  const canReview =
    job.reviewReady &&
    job.issue !== "cancellation_requires_review" &&
    requestedAction !== "cancel" &&
    (job.phase === "awaitingReview" || job.phase === "paused");
  const cancellable = !["publishing", "completed", "cancelled"].includes(
    job.phase,
  );
  const issue = transferIssue(job.issue);
  return (
    <section aria-label="Selected transfer" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold" role="status">
          {transferPhaseLabels[job.phase]}
        </h3>
        <span className="text-muted-foreground">
          {job.mode} · {job.batches.toLocaleString()} batches
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Source</dt>
        <dd className="break-all">
          {review?.fileImport?.fileName ?? connectionNames[job.source.connectionId] ?? job.source.connectionId}{" "}
          · {review?.fileImport?.format.toUpperCase() ?? transferEndpointName(job.source)}
        </dd>
        <dt className="text-muted-foreground">Target</dt>
        <dd className="break-all">
          {connectionNames[job.target.connectionId] ?? job.target.connectionId}{" "}
          · {transferEndpointName(job.target)}
        </dd>
        <dt className="text-muted-foreground">Snapshot rows</dt>
        <dd className="tabular-nums">{job.sourceRows.toLocaleString()}</dd>
        <dt className="text-muted-foreground">Private snapshot</dt>
        <dd className="tabular-nums">
          {(job.snapshotBytes / 1024 / 1024).toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}{" "}
          MiB
        </dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>
          <time dateTime={new Date(job.createdAt).toISOString()}>
            {new Date(job.createdAt).toLocaleString()}
          </time>
        </dd>
      </dl>
      {["copying", "paused", "publishing", "completed"].includes(job.phase) && (
        <div className="space-y-1">
          <progress
            className="h-2 w-full appearance-none overflow-hidden rounded-sm bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-[hsl(var(--wb-accent))] [&::-moz-progress-bar]:bg-[hsl(var(--wb-accent))]"
            max={Math.max(job.sourceRows, 1)}
            value={job.rowsStaged}
            aria-label="Rows staged"
          />
          <p className="tabular-nums text-muted-foreground">
            {job.rowsStaged.toLocaleString()} /{" "}
            {job.sourceRows.toLocaleString()} rows staged
          </p>
        </div>
      )}
      {job.phase === "preparing" && (
        <p className="text-muted-foreground">
          Creating and checking a stable source snapshot. Closing this dialog
          keeps preparation running while the app is open.
        </p>
      )}
      {job.phase === "copying" && (
        <p className="text-muted-foreground">
          Batches are saved in the target's staging area. Existing target rows
          stay in place until final publication.
        </p>
      )}
      {job.phase === "publishing" && (
        <p role="status">
          All batches are staged. Publishing the target in one transaction;
          pause and cancel are unavailable until it finishes.
        </p>
      )}
      {job.phase === "completed" && (
        <p role="status">
          The full snapshot was published successfully. This transfer will not
          insert its rows again.
        </p>
      )}
      {job.phase === "cancelled" && (
        <p role="status">
          Transfer cancelled. Existing target rows were preserved.
        </p>
      )}
      {issue && (
        <p role="alert" className="text-destructive">
          {issue}
        </p>
      )}
      {canReview && !review && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={controller.reloadReview}
        >
          Reload review
        </Button>
      )}
      {review && canReview && (
        <>
          <dl className="flex flex-wrap gap-x-5 gap-y-1">
            <div>
              <dt className="inline text-muted-foreground">
                Existing target rows:{" "}
              </dt>
              <dd className="inline tabular-nums">
                {review.targetRowsBefore.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Mapped columns: </dt>
              <dd className="inline">{review.mappedColumns.length}</dd>
            </div>
          </dl>
          <details>
            <summary className="cursor-pointer py-1 font-medium">
              Review column mapping
            </summary>
            <div className="max-h-40 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="py-1">Source</th>
                    <th className="py-1">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {review.mappedColumns.map((column) => (
                    <tr
                      key={column.target}
                      className="border-t border-border-subtle"
                    >
                      <td className="break-all py-1 pr-3">
                        {column.source}{" "}
                        <span className="text-muted-foreground">
                          {column.sourceType}
                        </span>
                      </td>
                      <td className="break-all py-1">
                        {column.target}{" "}
                        <span className="text-muted-foreground">
                          {column.targetType}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!review.skippedColumns.length && (
              <p className="text-muted-foreground">
                Generated columns skipped: {review.skippedColumns.join(", ")}
              </p>
            )}
          </details>
          <ul className="list-disc space-y-2 pl-4 text-muted-foreground">
            {review.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <div className="space-y-2">
            <p className="break-all font-medium">
              Confirm {job.mode} to{" "}
              {connectionNames[job.target.connectionId] ??
                job.target.connectionId}{" "}
              · {transferEndpointName(job.target)}
            </p>
            <label
              htmlFor="large-transfer-confirmation"
              className="block font-medium"
            >
              Type <code>{review.confirmationToken}</code> to{" "}
              {job.phase === "paused" ? "resume" : "start"}
            </label>
            <Input
              id="large-transfer-confirmation"
              autoComplete="off"
              spellCheck={false}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy || !!requestedAction}
            />
            <Button
              size="sm"
              variant={job.mode === "overwrite" ? "destructive" : "default"}
              disabled={
                busy ||
                !!requestedAction ||
                confirmation.trim() !== review.confirmationToken
              }
              onClick={() => void controller.start()}
            >
              {job.phase === "paused"
                ? review?.fileImport ? "Resume import" : "Resume full transfer"
                : review?.fileImport ? "Start import" : "Start full transfer"}
            </Button>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {job.phase === "copying" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !!requestedAction}
            onClick={() => void controller.requestAction("pause")}
          >
            Pause after batch
          </Button>
        )}
        {cancellable && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || requestedAction === "cancel"}
            onClick={() => void controller.requestAction("cancel")}
          >
            {review?.fileImport ? "Cancel import" : "Cancel transfer"}
          </Button>
        )}
        {requestedAction && (
          <span role="status" className="text-muted-foreground">
            {requestedAction === "pause"
              ? "Pause requested; finishing the current batch."
              : "Cancellation requested; cleaning up owned staging data."}
          </span>
        )}
      </div>
    </section>
  );
}
