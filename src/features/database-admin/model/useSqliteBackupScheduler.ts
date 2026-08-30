import { databaseService } from "@/services/tauri/database.service";
import { ensureConnectionReadyInBackground } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useEffect } from "react";

const SCHEDULER_POLL_INTERVAL_MS = 30_000;
const MAX_DUE_RUNS_PER_TICK = 10;

/**
 * Renderer lifecycle for Host-owned SQLite schedules.
 *
 * The Host remains authoritative for paths, due-time revalidation, retention,
 * progress and cancellation. This hook only restores the saved connection
 * session without changing workbench selection, then asks the Host to run one
 * already-due schedule. Work is sequential and single-flight so a timer cannot
 * create a connection or disk-I/O stampede.
 */
export function useSqliteBackupScheduler() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  useEffect(() => {
    let disposed = false;
    let running = false;

    const processDueSchedules = async () => {
      if (disposed || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const now = Date.now();
        const schedules = (await databaseService.listSqliteBackupSchedules())
          .filter(
            (schedule) =>
              schedule.enabled &&
              schedule.projectId === activeProjectId &&
              Date.parse(schedule.nextRunAt) <= now,
          )
          .sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt))
          .slice(0, MAX_DUE_RUNS_PER_TICK);

        for (const schedule of schedules) {
          if (disposed) return;
          await ensureConnectionReadyInBackground(schedule.connectionId);
          if (disposed) return;
          // Run even when session restoration failed. The Host records a
          // bounded failed receipt and advances the next due time rather than
          // retrying the same unavailable source every 30 seconds.
          await databaseService
            .runSqliteBackupSchedule(schedule.id, "scheduled")
            .catch(() => undefined);
        }
      } catch {
        // Settings shows actionable Host errors. A background scheduler must
        // not interrupt editor input with a toast or an unhandled rejection.
      } finally {
        running = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void processDueSchedules();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(
      () => void processDueSchedules(),
      SCHEDULER_POLL_INTERVAL_MS,
    );
    void processDueSchedules();

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeProjectId]);
}
