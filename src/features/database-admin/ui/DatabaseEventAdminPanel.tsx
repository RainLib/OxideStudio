import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  databaseAdminErrorPresentation,
  type DatabaseAdminErrorPresentation,
} from "@/features/database-admin/model/databaseAdminErrors";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/tauri";
import type {
  DatabaseAdminEvent,
  DatabaseAdminEventIntervalUnit,
  DatabaseAdminEventMutation,
  DatabaseAdminEventPlan,
  DatabaseDriver,
} from "@/services/tauri/types";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface DatabaseEventAdminPanelProps {
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
}

type ScheduleMode = "interval" | "once";

const INTERVAL_UNITS: DatabaseAdminEventIntervalUnit[] = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

function eventScheduleLabel(event: DatabaseAdminEvent) {
  if (event.eventType?.toUpperCase() === "ONE TIME")
    return event.executeAt ? `Once · ${event.executeAt}` : "Once";
  if (event.intervalValue || event.intervalField)
    return `Every ${event.intervalValue || "?"} ${(event.intervalField || "interval").toLowerCase()}`;
  return event.eventType || "Schedule unavailable";
}

function eventEnabled(event: DatabaseAdminEvent) {
  return event.status?.toUpperCase() === "ENABLED";
}

export function DatabaseEventAdminPanel({
  connectionId,
  driver,
  schema,
}: DatabaseEventAdminPanelProps) {
  const [events, setEvents] = useState<DatabaseAdminEvent[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<DatabaseAdminErrorPresentation | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("interval");
  const [intervalValue, setIntervalValue] = useState(1);
  const [intervalUnit, setIntervalUnit] =
    useState<DatabaseAdminEventIntervalUnit>("day");
  const [executeAt, setExecuteAt] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [preserveAfterCompletion, setPreserveAfterCompletion] = useState(true);
  const [comment, setComment] = useState("");
  const [body, setBody] = useState("");
  const [pendingMutation, setPendingMutation] =
    useState<DatabaseAdminEventMutation | null>(null);
  const [plan, setPlan] = useState<DatabaseAdminEventPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const loadGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    if (!schema.trim()) {
      setEvents([]);
      setSchedulerStatus(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const catalog = await databaseService.listDatabaseAdminEvents(
        connectionId,
        driver,
        schema,
      );
      if (loadGenerationRef.current === generation) {
        setEvents(catalog.events);
        setSchedulerStatus(catalog.schedulerStatus || null);
      }
    } catch (reason) {
      if (loadGenerationRef.current === generation)
        setError(databaseAdminErrorPresentation(reason));
    } finally {
      if (loadGenerationRef.current === generation) setIsLoading(false);
    }
  }, [connectionId, driver, schema]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
      previewGenerationRef.current += 1;
    };
  }, [load]);

  const resetCreate = () => {
    setName("");
    setScheduleMode("interval");
    setIntervalValue(1);
    setIntervalUnit("day");
    setExecuteAt("");
    setStarts("");
    setEnds("");
    setEnabled(true);
    setPreserveAfterCompletion(true);
    setComment("");
    setBody("");
  };

  const closePlan = () => {
    if (isMutating) return;
    const reopenCreate = pendingMutation?.action === "create";
    setPlan(null);
    setPendingMutation(null);
    setConfirmation("");
    if (reopenCreate) setCreateOpen(true);
  };

  const preview = async (mutation: DatabaseAdminEventMutation) => {
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    setIsPreviewing(true);
    setPendingMutation(mutation);
    setPlan(null);
    setConfirmation("");
    setError(null);
    setResult(null);
    try {
      const nextPlan = await databaseService.previewDatabaseAdminEventMutation(
        connectionId,
        driver,
        mutation,
      );
      if (previewGenerationRef.current !== generation) return;
      setPlan(nextPlan);
      if (mutation.action === "create") setCreateOpen(false);
    } catch (reason) {
      if (previewGenerationRef.current !== generation) return;
      setPendingMutation(null);
      setError(databaseAdminErrorPresentation(reason));
    } finally {
      if (previewGenerationRef.current === generation) setIsPreviewing(false);
    }
  };

  const createMutation = useMemo<DatabaseAdminEventMutation>(
    () => ({
      action: "create",
      event: {
        schema,
        name,
        schedule:
          scheduleMode === "once"
            ? { kind: "once", executeAt }
            : {
                kind: "interval",
                intervalValue,
                intervalUnit,
                starts: starts.trim() || undefined,
                ends: ends.trim() || undefined,
              },
        preserveAfterCompletion,
        enabled,
        comment: comment.trim() || undefined,
        body,
      },
    }),
    [
      body,
      comment,
      enabled,
      ends,
      executeAt,
      intervalUnit,
      intervalValue,
      name,
      preserveAfterCompletion,
      scheduleMode,
      schema,
      starts,
    ],
  );

  const canPreviewCreate =
    Boolean(schema.trim() && name.trim() && body.trim()) &&
    (scheduleMode === "once"
      ? Boolean(executeAt.trim())
      : Number.isInteger(intervalValue) && intervalValue > 0);

  const execute = async () => {
    if (
      !pendingMutation ||
      !plan ||
      confirmation !== plan.confirmationText
    )
      return;
    setIsMutating(true);
    setError(null);
    try {
      const message = await databaseService.executeDatabaseAdminEventMutation(
        connectionId,
        driver,
        {
          mutation: pendingMutation,
          confirmationToken: plan.confirmationToken,
          confirmationText: confirmation,
        },
      );
      setResult(message);
      const created = pendingMutation.action === "create";
      setPlan(null);
      setPendingMutation(null);
      setConfirmation("");
      if (created) {
        setCreateOpen(false);
        resetCreate();
      }
      await load();
    } catch (reason) {
      setError(databaseAdminErrorPresentation(reason));
    } finally {
      setIsMutating(false);
    }
  };

  if (!schema.trim()) {
    return (
      <div className="px-3 py-5 text-[11px] wb-muted">
        Select a default database on this MySQL connection before managing scheduled events.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3">
        <CalendarClock size={13} className="text-[hsl(var(--wb-accent))]" />
        <span className="min-w-0 flex-1 truncate text-[11px]">
          Scheduled events in <strong>{schema}</strong>
        </span>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          title="Refresh scheduled events"
          onClick={() => void load()}
          disabled={isLoading || isMutating}
        >
          <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
        </button>
        <Button
          type="button"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => setCreateOpen(true)}
          disabled={isMutating || isPreviewing}
        >
          <Plus size={11} className="mr-1" /> New event
        </Button>
      </div>

      {error && (
        <div role="alert" className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
          <div className="font-medium">{error.title}</div>
          <div className="mt-0.5 text-red-200/80">{error.message}</div>
        </div>
      )}
      {schedulerStatus && schedulerStatus.toUpperCase() !== "ON" && (
        <div role="status" className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            The server event scheduler is <strong>{schedulerStatus}</strong>. Enabled events will not run until an administrator enables the global scheduler.
          </span>
        </div>
      )}
      {result && (
        <div role="status" aria-live="polite" className="flex items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
          <CheckCircle2 size={12} /> {result}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="px-3 py-4 text-[11px] wb-muted">Loading scheduled events…</div>
        ) : events.length === 0 ? (
          <div className="px-3 py-5 text-[11px] italic wb-muted">
            No visible scheduled events in this database.
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
            {events.map((event) => {
              const isEnabled = eventEnabled(event);
              return (
                <div key={`${event.schema}:${event.name}`} className="group flex min-w-0 items-start gap-2 px-3 py-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
                  <CalendarClock size={13} className={cn("mt-0.5 shrink-0", isEnabled ? "text-emerald-400" : "wb-muted")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{event.name}</span>
                      <span className={cn("rounded border px-1 py-0.5 text-[9px]", isEnabled ? "border-emerald-500/30 text-emerald-300" : "border-[hsl(var(--wb-border-subtle))] wb-muted")}>
                        {event.status || "UNKNOWN"}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] wb-muted">
                      {eventScheduleLabel(event)}
                      {event.lastExecuted ? ` · last ${event.lastExecuted}` : ""}
                    </div>
                    {event.comment && <div className="mt-0.5 truncate text-[10px] wb-muted">{event.comment}</div>}
                  </div>
                  <button
                    type="button"
                    className="wb-icon-button h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    title={isEnabled ? "Disable event" : "Enable event"}
                    disabled={isMutating || isPreviewing}
                    onClick={() =>
                      void preview({
                        action: "setEnabled",
                        schema: event.schema,
                        name: event.name,
                        enabled: !isEnabled,
                      })
                    }
                  >
                    {isEnabled ? <Pause size={11} /> : <Play size={11} />}
                  </button>
                  <button
                    type="button"
                    className="wb-icon-button h-6 w-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    title="Delete event"
                    disabled={isMutating || isPreviewing}
                    onClick={() =>
                      void preview({
                        action: "delete",
                        schema: event.schema,
                        name: event.name,
                      })
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(nextOpen) => {
          if (!isMutating) {
            setCreateOpen(nextOpen);
            if (!nextOpen && isPreviewing) {
              previewGenerationRef.current += 1;
              setIsPreviewing(false);
              setPendingMutation(null);
            }
          }
        }}
      >
        <DialogContent layout="custom" className="max-w-[680px] p-0">
          <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
            <DialogTitle className="text-[13px]">Create scheduled event</DialogTitle>
            <DialogDescription className="text-[11px] wb-muted">
              {schema} · one reviewed DML, REPLACE, or CALL statement
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-4 py-4 text-[11px] sm:grid-cols-2">
            <label className="grid gap-1">
              <span>Event name</span>
              <input className="wb-input h-8" value={name} onChange={(event) => setName(event.target.value)} disabled={isMutating} />
            </label>
            <label className="grid gap-1">
              <span>Schedule</span>
              <select className="wb-input h-8" value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as ScheduleMode)} disabled={isMutating}>
                <option value="interval">Repeat on an interval</option>
                <option value="once">Run once</option>
              </select>
            </label>
            {scheduleMode === "interval" ? (
              <>
                <label className="grid gap-1">
                  <span>Every</span>
                  <div className="grid grid-cols-[1fr_1.4fr] gap-2">
                    <input className="wb-input h-8" type="number" min={1} max={1_000_000} value={intervalValue} onChange={(event) => setIntervalValue(Number(event.target.value))} disabled={isMutating} />
                    <select className="wb-input h-8" value={intervalUnit} onChange={(event) => setIntervalUnit(event.target.value as DatabaseAdminEventIntervalUnit)} disabled={isMutating}>
                      {INTERVAL_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </div>
                </label>
                <label className="grid gap-1">
                  <span>Starts (optional)</span>
                  <input className="wb-input h-8" placeholder="YYYY-MM-DD HH:MM:SS" value={starts} onChange={(event) => setStarts(event.target.value)} disabled={isMutating} />
                </label>
                <label className="grid gap-1 sm:col-start-2">
                  <span>Ends (optional)</span>
                  <input className="wb-input h-8" placeholder="YYYY-MM-DD HH:MM:SS" value={ends} onChange={(event) => setEnds(event.target.value)} disabled={isMutating} />
                </label>
              </>
            ) : (
              <label className="grid gap-1 sm:col-span-2">
                <span>Execute at</span>
                <input className="wb-input h-8" placeholder="YYYY-MM-DD HH:MM:SS" value={executeAt} onChange={(event) => setExecuteAt(event.target.value)} disabled={isMutating} />
              </label>
            )}
            <label className="grid gap-1 sm:col-span-2">
              <span>Statement</span>
              <textarea className="wb-input min-h-[96px] resize-y px-2 py-1.5 font-mono text-[10px]" placeholder="CALL refresh_cache()" value={body} onChange={(event) => setBody(event.target.value)} disabled={isMutating} />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span>Comment (optional)</span>
              <input className="wb-input h-8" value={comment} onChange={(event) => setComment(event.target.value)} disabled={isMutating} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={isMutating} /> Enabled after creation
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={preserveAfterCompletion} onChange={(event) => setPreserveAfterCompletion(event.target.checked)} disabled={isMutating} /> Preserve after completion
            </label>
          </div>
          <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:space-x-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={isMutating}>Cancel</Button>
            <Button type="button" size="sm" disabled={!canPreviewCreate || isMutating || isPreviewing} onClick={() => void preview(createMutation)}>{isPreviewing ? "Reviewing…" : "Review event"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(plan)} onOpenChange={(nextOpen) => !nextOpen && closePlan()}>
        <DialogContent layout="custom" className="max-w-[680px] p-0">
          <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-[13px]">
              <AlertTriangle size={14} className="text-amber-300" /> Review scheduled event
            </DialogTitle>
            <DialogDescription className="text-[11px] wb-muted">{plan?.target}</DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="space-y-3 px-4 py-4 text-[11px]">
              <div className="rounded-[4px] border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <div className="font-medium text-amber-200">{plan.summary}</div>
                <div className="mt-1 text-amber-200/75">The server may execute this statement later without Oxide being open.</div>
              </div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-3 py-2 font-mono text-[10px] wb-muted">{plan.sqlPreview}</pre>
              <label className="grid gap-1.5">
                <span>Type <code className="font-mono text-[hsl(var(--wb-text))]">{plan.confirmationText}</code> to confirm:</span>
                <input aria-label="Scheduled event confirmation text" className="wb-input h-8 font-mono" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={isMutating} />
              </label>
            </div>
          )}
          <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:space-x-0">
            <Button type="button" variant="ghost" size="sm" onClick={closePlan} disabled={isMutating}>Cancel</Button>
            <Button type="button" variant={plan?.risk === "high" ? "destructive" : "default"} size="sm" disabled={!plan || confirmation !== plan.confirmationText || isMutating} onClick={() => void execute()}>
              {isMutating ? "Applying event…" : "Apply event change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
