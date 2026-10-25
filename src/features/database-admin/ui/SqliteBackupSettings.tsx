import { confirmAction } from "@/lib/appDialogs";
import { Button } from "@/components/ui/button";
import { SqliteBackupFiles } from "./SqliteBackupFiles";
import { confirmSqliteBackupFileDeletion } from "../model/confirmSqliteBackupFileDeletion";
import { backupTimeZoneChoices, defaultBackupTimeZone, displayNextBackup } from "../model/sqliteBackupTimeZone";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/tauri/database.service";
import type {
  SaveSqliteBackupScheduleRequest,
  SqliteBackupCompression,
  SqliteBackupRun,
  SqliteBackupRunStatus,
  SqliteBackupSchedule,
  SqliteBackupScheduleFrequency,
  SqliteBackupWorkerStatus,
} from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { open as openPath } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  FolderOpen,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ScheduleDraft {
  id?: string;
  name: string;
  connectionId: string;
  destinationDirectory: string;
  frequency: SqliteBackupScheduleFrequency;
  intervalHours: number;
  timeOfDay: string;
  timeZone: string;
  weekday: number;
  retentionCount: number;
  compression: SqliteBackupCompression;
  enabled: boolean;
}

const inputClass =
  "h-7 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-2 text-[12px] text-[hsl(var(--wb-text))] outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]";
const selectClass = cn(inputClass, "w-full");
const backupDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function newDraft(connectionId = ""): ScheduleDraft {
  return {
    name: "Nightly SQLite backup",
    connectionId,
    destinationDirectory: "",
    frequency: "daily",
    intervalHours: 24,
    timeOfDay: "02:00",
    timeZone: defaultBackupTimeZone(),
    weekday: 1,
    retentionCount: 7,
    compression: "none",
    enabled: true,
  };
}

function scheduleDraft(schedule: SqliteBackupSchedule): ScheduleDraft {
  return {
    id: schedule.id,
    name: schedule.name,
    connectionId: schedule.connectionId,
    destinationDirectory: schedule.destinationDirectory,
    frequency: schedule.frequency,
    intervalHours: schedule.intervalHours,
    timeOfDay: schedule.timeOfDay,
    timeZone: schedule.timeZone ?? "system",
    weekday: schedule.weekday,
    retentionCount: schedule.retentionCount,
    compression: schedule.compression ?? "none",
    enabled: schedule.enabled,
  };
}

function displayDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return backupDateFormatter.format(date);
}

function displayBytes(value?: number | null) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function frequencyLabel(schedule: SqliteBackupSchedule) {
  if (schedule.frequency === "hourly") {
    return `Every ${schedule.intervalHours} hour${schedule.intervalHours === 1 ? "" : "s"}`;
  }
  if (schedule.frequency === "weekly") {
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${day[schedule.weekday] || "Mon"} at ${schedule.timeOfDay} · ${schedule.timeZone ?? "System time zone"}`;
  }
  return `Daily at ${schedule.timeOfDay} · ${schedule.timeZone ?? "System time zone"}`;
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function StatusMark({ status }: { status: SqliteBackupRunStatus }) {
  const style = {
    queued: {
      icon: Clock3,
      label: "Queued",
      className: "text-[hsl(var(--wb-text-muted))]",
    },
    success: {
      icon: CheckCircle2,
      label: "Completed",
      className: "text-emerald-400",
    },
    running: {
      icon: RefreshCw,
      label: "Running",
      className: "text-[hsl(var(--wb-accent))]",
    },
    failed: {
      icon: XCircle,
      label: "Failed",
      className: "text-[hsl(var(--destructive))]",
    },
    cancelled: {
      icon: Pause,
      label: "Cancelled",
      className: "text-amber-400",
    },
    interrupted: {
      icon: AlertCircle,
      label: "Interrupted",
      className: "text-amber-400",
    },
  }[status];
  const Icon = style.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", style.className)}>
      <Icon size={12} className={status === "running" ? "animate-spin" : undefined} />
      {style.label}
    </span>
  );
}

export function SqliteBackupSettings() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const connections = useConnectionStore((state) => state.connections);
  const sqliteConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.driver === "sqlite" &&
          !connection.driverPackageVersion &&
          !connection.sshTunnel?.enabled &&
          connection.origin !== "managed",
      ),
    [connections],
  );
  const connectionNames = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection.name])),
    [connections],
  );
  const [schedules, setSchedules] = useState<SqliteBackupSchedule[]>([]);
  const [runs, setRuns] = useState<SqliteBackupRun[]>([]);
  const [worker, setWorker] = useState<SqliteBackupWorkerStatus>({ backgroundEnabled: false, running: false });
  const [changingBackground, setChangingBackground] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyScheduleId, setBusyScheduleId] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | SqliteBackupRunStatus>(
    "all",
  );
  const [error, setError] = useState<string | null>(null);
  const loadRevision = useRef(0);
  const backgroundRevision = useRef(0);
  const backgroundHelpId = useId();

  const refresh = useCallback(async (showLoading = false) => {
    const revision = ++loadRevision.current;
    const workerRevision = backgroundRevision.current;
    if (showLoading) setLoading(true);
    try {
      const [nextSchedules, nextRuns, nextWorker] = await Promise.all([
        databaseService.listSqliteBackupSchedules(),
        databaseService.listSqliteBackupRuns(),
        databaseService.getSqliteBackupWorkerStatus(),
      ]);
      if (revision !== loadRevision.current) return;
      setSchedules(
        nextSchedules.filter((schedule) => schedule.projectId === activeProjectId),
      );
      setRuns(nextRuns.filter((run) => run.projectId === activeProjectId));
      if (workerRevision === backgroundRevision.current) setWorker(nextWorker);
      setError(null);
    } catch (reason) {
      if (revision === loadRevision.current) setError(errorMessage(reason));
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    setDraft(null);
    void refresh(true);
    return () => { loadRevision.current += 1; };
  }, [refresh]);

  const hasRunningBackup = runs.some((run) => run.status === "running" || run.status === "queued");
  const activeRunsBySchedule = useMemo(() => {
    const active = new Map<string, SqliteBackupRun>();
    for (const run of runs) {
      if ((run.status === "running" || run.status === "queued") && !active.has(run.scheduleId)) {
        active.set(run.scheduleId, run);
      }
    }
    return active;
  }, [runs]);
  const visibleRuns = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    return runs
      .filter((run) => historyStatus === "all" || run.status === historyStatus)
      .filter((run) => {
        if (!query) return true;
        return [run.scheduleName, run.filePath, run.error, run.trigger]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(query));
      })
      .slice(0, 50);
  }, [historyQuery, historyStatus, runs]);
  useEffect(() => {
    const timer = window.setInterval(
      () => void refresh(),
      hasRunningBackup ? 750 : 10_000,
    );
    return () => window.clearInterval(timer);
  }, [hasRunningBackup, refresh]);

  const chooseDirectory = async () => {
    try {
      const selected = await openPath({
        title: "Choose scheduled backup folder",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") {
        setDraft((current) =>
          current ? { ...current, destinationDirectory: selected } : current,
        );
      }
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.connectionId) {
      setError("Choose a local SQLite data source.");
      return;
    }
    if (!draft.destinationDirectory.trim()) {
      setError("Choose a backup destination folder.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const request: SaveSqliteBackupScheduleRequest = {
        ...draft,
        projectId: activeProjectId,
        name: draft.name.trim(),
        destinationDirectory: draft.destinationDirectory.trim(),
      };
      await databaseService.saveSqliteBackupSchedule(request);
      setDraft(null);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const updateSchedule = async (
    schedule: SqliteBackupSchedule,
    updates: Partial<ScheduleDraft>,
  ) => {
    setError(null);
    try {
      await databaseService.saveSqliteBackupSchedule({
        ...scheduleDraft(schedule),
        ...updates,
        projectId: activeProjectId,
      });
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const runNow = async (schedule: SqliteBackupSchedule) => {
    setBusyScheduleId(schedule.id);
    setError(null);
    try {
      const task = databaseService.runSqliteBackupSchedule(schedule.id);
      await refresh();
      await task;
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
      await refresh();
    } finally {
      setBusyScheduleId(null);
    }
  };

  const deleteSchedule = async (schedule: SqliteBackupSchedule) => {
    if (!(await confirmAction(`Delete schedule “${schedule.name}”? Backup history is kept.`))) {
      return;
    }
    setError(null);
    try {
      await databaseService.deleteSqliteBackupSchedule(schedule.id);
      if (draft?.id === schedule.id) setDraft(null);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const cancelRun = async (run: SqliteBackupRun) => {
    setError(null);
    try {
      await databaseService.cancelSqliteBackupRun(run.id);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const deleteRun = async (run: SqliteBackupRun) => {
    setError(null);
    try {
      const confirmation = await confirmSqliteBackupFileDeletion(run.id);
      if (confirmation === null) return;
      await databaseService.deleteSqliteBackupRun(run.id, confirmation);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const changeBackground = async (enabled: boolean) => {
    backgroundRevision.current += 1;
    setChangingBackground(true);
    setError(null);
    try {
      setWorker(await databaseService.setSqliteBackupBackgroundEnabled(enabled));
    } catch (reason) {
      try {
        setWorker(await databaseService.getSqliteBackupWorkerStatus());
      } catch {
        // Preserve the actionable setting error.
      }
      setError(errorMessage(reason));
    } finally {
      backgroundRevision.current += 1;
      setChangingBackground(false);
    }
  };

  return (
    <div className="w-full max-w-[880px] pb-8">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[hsl(var(--wb-border-subtle))] pb-4">
        <div className="max-w-[620px]">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold">
            <DatabaseBackup size={15} className="text-[hsl(var(--wb-accent))]" />
            Native SQLite schedules
          </div>
          <p className="text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
            Oxide uses SQLite's online-backup API, publishes only integrity-checked
            files, and prunes only files created by this schedule. A native worker
            runs schedules from every project, including while the window is hidden.
          </p>
        </div>
        <Button
          size="sm"
          className="h-7 rounded-[4px] px-3 text-[12px]"
          disabled={!sqliteConnections.length || Boolean(draft)}
          onClick={() => setDraft(newDraft(sqliteConnections[0]?.id))}
        >
          <Plus size={13} className="mr-1" /> Add schedule
        </Button>
      </div>

      <div className="mb-4 rounded-[4px] border border-[hsl(var(--wb-border))] px-3 py-2">
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={worker.backgroundEnabled}
            disabled={loading || changingBackground}
            aria-describedby={backgroundHelpId}
            onChange={(event) => void changeBackground(event.target.checked)}
          />
          Continue backups after closing OxideStudio
        </label>
        <p id={backgroundHelpId} className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          Starts the backup worker when you sign in. Your computer must be awake and you must remain signed in.
          With this option off, quitting OxideStudio cancels the active backup; queued work resumes when you reopen it.
        </p>
        {worker.message && <p role="status" aria-live="polite" className={cn("mt-2 flex items-start gap-1.5 text-[11px] leading-4", worker.upgrading ? "text-[hsl(var(--wb-text-muted))]" : "text-[hsl(var(--wb-error-text))]")}>
          {worker.upgrading ? <RefreshCw size={12} className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
          <span>{worker.message}</span>
        </p>}
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-[4px] border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.08)] px-3 py-2 text-[11px] text-[hsl(var(--wb-error-text))]">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!sqliteConnections.length && (
        <div className="mb-5 border-l-2 border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-panel))] px-4 py-3 text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
          Add a local SQLite data source before creating a schedule. External driver
          packages and remote SQLite files stay read-only for scheduled backup.
        </div>
      )}

      {draft && (
        <ScheduleEditor
          draft={draft}
          connections={sqliteConnections}
          saving={saving}
          onChange={setDraft}
          onChooseDirectory={() => void chooseDirectory()}
          onSave={() => void saveDraft()}
          onCancel={() => setDraft(null)}
        />
      )}

      <section aria-labelledby="backup-schedules-heading">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="backup-schedules-heading" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[hsl(var(--wb-text-muted))]">
            Schedule ledger
          </h3>
          <button type="button" onClick={() => void refresh(true)} className="inline-flex items-center gap-1 text-[11px] text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]">
            <RefreshCw size={12} className={loading ? "animate-spin" : undefined} /> Refresh
          </button>
        </div>
        <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
          {!loading && !schedules.length ? (
            <div className="px-4 py-8 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
              No schedules yet. Add one to keep reviewed SQLite recovery points.
            </div>
          ) : (
            schedules.map((schedule, index) => {
              const activeRun = activeRunsBySchedule.get(schedule.id);
              return (
                <div key={schedule.id} className={cn("px-3 py-3", index > 0 && "border-t border-[hsl(var(--wb-border-subtle))]")}>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex w-5 shrink-0 justify-center">
                      <span className={cn("h-2 w-2 rounded-full ring-4", schedule.enabled ? "bg-emerald-400 ring-emerald-400/10" : "bg-[hsl(var(--wb-text-muted))] ring-transparent")} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-[12px]">{schedule.name}</span>
                        <span className="text-[11px] text-[hsl(var(--wb-text-muted))]">{connectionNames.get(schedule.connectionId) || "Missing data source"}</span>
                        {schedule.lastRunStatus && <StatusMark status={schedule.lastRunStatus} />}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
                        <span>{frequencyLabel(schedule)}</span>
                        <span>Next {displayNextBackup(schedule)}</span>
                        <span>Keep {schedule.retentionCount}</span>
                        <span>{(schedule.compression ?? "none") === "gzip" ? "Gzip" : "Uncompressed"}</span>
                      </div>
                      <div title={schedule.destinationDirectory} className="mt-1 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                        {schedule.destinationDirectory}
                      </div>
                      {schedule.schedulingError && <p role="status" className="mt-1 text-[11px] leading-4 text-[hsl(var(--wb-error-text))]">Automation paused: {schedule.schedulingError}. Review the timing settings and enable this schedule to resume.</p>}
                      {activeRun && (
                        <div className="mt-3 flex items-center gap-2">
                          <div role="progressbar" aria-label={`${schedule.name} backup progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={activeRun.progressPercent} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[hsl(var(--wb-border-subtle))]">
                            <div className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${activeRun.progressPercent}%` }} />
                          </div>
                          <span className="w-8 text-right font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">{activeRun.progressPercent}%</span>
                          <button type="button" onClick={() => void cancelRun(activeRun)} className="text-[10px] text-amber-400 hover:underline">Cancel</button>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch checked={schedule.enabled} aria-label={`${schedule.enabled ? "Pause" : "Enable"} ${schedule.name}`} onCheckedChange={(enabled) => void updateSchedule(schedule, { enabled })} className="mr-1 h-4 w-7 data-[state=checked]:bg-emerald-500 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3" />
                      <IconButton label="Run now" disabled={Boolean(activeRun) || busyScheduleId === schedule.id} onClick={() => void runNow(schedule)}><Play size={13} /></IconButton>
                      <IconButton label="Edit schedule" disabled={Boolean(activeRun)} onClick={() => setDraft(scheduleDraft(schedule))}><Pencil size={13} /></IconButton>
                      <IconButton label="Delete schedule" disabled={Boolean(activeRun)} onClick={() => void deleteSchedule(schedule)}><Trash2 size={13} /></IconButton>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section aria-labelledby="backup-history-heading" className="mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="mr-auto flex items-center gap-2">
            <History size={13} className="text-[hsl(var(--wb-text-muted))]" />
            <h3 id="backup-history-heading" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[hsl(var(--wb-text-muted))]">Recent runs</h3>
          </div>
          <Input
            aria-label="Filter backup history"
            className={cn(inputClass, "w-44")}
            value={historyQuery}
            placeholder="Filter name or path"
            onChange={(event) => setHistoryQuery(event.target.value)}
          />
          <select
            aria-label="Filter backup status"
            className={cn(selectClass, "w-28")}
            value={historyStatus}
            onChange={(event) =>
              setHistoryStatus(event.target.value as "all" | SqliteBackupRunStatus)
            }
          >
            <option value="all">All statuses</option>
            <option value="success">Completed</option>
            <option value="queued">Queued</option>
                <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="interrupted">Interrupted</option>
          </select>
        </div>
        <div className="overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
          {!visibleRuns.length ? (
            <div className="px-4 py-6 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
              {runs.length
                ? "No backup runs match the current filters."
                : "No backup runs recorded for this project."}
            </div>
          ) : (
            visibleRuns.map((run, index) => (
              <div key={run.id} className={cn("grid grid-cols-[18px_minmax(0,1fr)_100px_72px_28px] items-center gap-2 px-3 py-2", index > 0 && "border-t border-[hsl(var(--wb-border-subtle))]")}>
                <span className={cn("h-2 w-2 rounded-full", run.status === "success" ? "bg-emerald-400" : run.status === "running" ? "bg-[hsl(var(--wb-accent))] animate-pulse" : run.status === "failed" ? "bg-[hsl(var(--destructive))]" : "bg-amber-400")} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="truncate text-[11px] font-medium">{run.scheduleName}</span><span className="text-[10px] text-[hsl(var(--wb-text-muted))]">{run.trigger}</span></div>
                  <div title={run.error || run.filePath || undefined} className={cn("mt-0.5 truncate text-[10px]", run.error ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--wb-text-muted))]")}>{run.error || run.filePath || "Preparing backup file"}</div>
                </div>
                <span className="text-[10px] text-[hsl(var(--wb-text-muted))]">{displayDate(run.startedAt)}</span>
                <span className="text-right font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">{run.status === "queued" ? "Queued" : run.status === "running" ? `${run.progressPercent}%` : displayBytes(run.byteLen)}</span>
                {run.status === "running" || run.status === "queued" ? (
                  <IconButton label="Cancel backup" onClick={() => void cancelRun(run)}><Pause size={12} /></IconButton>
                ) : (
                  <IconButton label="Delete backup file and history" onClick={() => void deleteRun(run)}><Trash2 size={12} /></IconButton>
                )}
              </div>
            ))
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          <ShieldCheck size={13} className="shrink-0 text-emerald-400" />
          Retention and delete actions are restricted to canonical files with Oxide's scheduled-backup filename prefix.
        </div>
      </section>
      <SqliteBackupFiles projectId={activeProjectId} refreshKey={`${runs[0]?.id ?? ""}/${runs[0]?.completedAt ?? ""}`} onDeleted={refresh} />
    </div>
  );
}

function ScheduleEditor({
  draft,
  connections,
  saving,
  onChange,
  onChooseDirectory,
  onSave,
  onCancel,
}: {
  draft: ScheduleDraft;
  connections: Array<{ id: string; name: string }>;
  saving: boolean;
  onChange: (draft: ScheduleDraft) => void;
  onChooseDirectory: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const timeZoneHelpId = useId();
  const timeZones = useMemo(() => backupTimeZoneChoices(draft.timeZone), [draft.timeZone]);
  return (
    <section className="mb-5 rounded-[5px] border border-[hsl(var(--wb-accent)/0.55)] bg-[hsl(var(--wb-panel))] p-4 shadow-[inset_3px_0_0_hsl(var(--wb-accent))]" aria-label={draft.id ? "Edit backup schedule" : "New backup schedule"}>
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold"><Clock3 size={14} className="text-[hsl(var(--wb-accent))]" />{draft.id ? "Edit schedule" : "New schedule"}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Name"><Input className={inputClass} value={draft.name} maxLength={80} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></Field>
        <Field label="SQLite data source"><select className={selectClass} value={draft.connectionId} onChange={(event) => onChange({ ...draft, connectionId: event.target.value })}>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></Field>
        <Field label="Destination folder" wide><div className="flex gap-2"><Input className={cn(inputClass, "min-w-0 flex-1 font-mono text-[10px]")} value={draft.destinationDirectory} readOnly placeholder="Choose a local folder" /><Button type="button" variant="outline" size="sm" className="h-7 rounded-[4px] px-2" onClick={onChooseDirectory}><FolderOpen size={13} /></Button></div></Field>
        <Field label="Frequency"><select className={selectClass} value={draft.frequency} onChange={(event) => onChange({ ...draft, frequency: event.target.value as SqliteBackupScheduleFrequency })}><option value="hourly">Hourly interval</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></Field>
        {draft.frequency === "hourly" ? (
          <Field label="Interval hours"><Input className={inputClass} type="number" min={1} max={168} value={draft.intervalHours} onChange={(event) => onChange({ ...draft, intervalHours: Number(event.target.value) || 1 })} /></Field>
        ) : (
          <Field label="Time of day"><Input className={inputClass} type="time" value={draft.timeOfDay} onChange={(event) => onChange({ ...draft, timeOfDay: event.target.value })} /></Field>
        )}
        <Field label="Time zone" wide><select className={selectClass} value={draft.timeZone} aria-describedby={timeZoneHelpId} onChange={(event) => onChange({ ...draft, timeZone: event.target.value })}><option value="system">System time zone · follows changes</option>{timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></Field>
        <p id={timeZoneHelpId} className="col-span-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {draft.frequency === "hourly"
            ? "Hourly intervals use elapsed hours, including across daylight saving changes. The selected zone applies if you switch to daily or weekly."
            : "Daily and weekly times stay in the selected zone. Nonexistent daylight saving times are skipped; repeated times run once, at the first occurrence."}
          {draft.timeZone === "system" && " This plan follows your computer's time zone, including when it changes. Choose a named zone to keep the same schedule when travelling."}
        </p>
        {draft.frequency === "weekly" && <Field label="Day"><select className={selectClass} value={draft.weekday} onChange={(event) => onChange({ ...draft, weekday: Number(event.target.value) })}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field>}
        <Field label="Keep successful backups"><Input className={inputClass} type="number" min={1} max={100} value={draft.retentionCount} onChange={(event) => onChange({ ...draft, retentionCount: Number(event.target.value) || 1 })} /></Field>
        <Field label="Compression"><select className={selectClass} value={draft.compression} onChange={(event) => onChange({ ...draft, compression: event.target.value as SqliteBackupCompression })}><option value="none">None · fastest restore</option><option value="gzip">Gzip · smaller files</option></select></Field>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] pt-3">
        <label className="flex items-center gap-2 text-[11px]"><Switch checked={draft.enabled} onCheckedChange={(enabled) => onChange({ ...draft, enabled })} className="h-4 w-7 data-[state=checked]:bg-emerald-500 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3" />Run automatically on schedule</label>
        <div className="flex gap-2"><Button type="button" variant="ghost" size="sm" className="h-7 rounded-[4px] text-[12px]" onClick={onCancel}>Cancel</Button><Button type="button" size="sm" className="h-7 rounded-[4px] text-[12px]" disabled={saving} onClick={onSave}>{saving ? "Saving…" : "Save schedule"}</Button></div>
      </div>
    </section>
  );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={cn("grid gap-1 text-[10px] text-[hsl(var(--wb-text-muted))]", wide && "col-span-2")}><span>{label}</span>{children}</label>;
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:pointer-events-none disabled:opacity-35">{children}</button>;
}
