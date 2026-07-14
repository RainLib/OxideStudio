import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronUp,
  Clock3,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTaskStore, type WorkbenchTask } from "@/store/useTaskStore";
import { useProjectStore } from "@/store/useProjectStore";
import { assistantTaskService } from "@/services/tauri/assistant-task.service";
import { assistantTaskToWorkbenchTask } from "@/lib/assistantTaskProjection";
import { cn } from "@/lib/utils";

function taskAge(task: WorkbenchTask) {
  const end = task.finishedAt || Date.now();
  const seconds = Math.max(0, Math.round((end - task.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function taskIcon(task: WorkbenchTask) {
  if (task.status === "running") {
    return <Loader2 size={12} className="animate-spin text-[hsl(var(--wb-accent))]" />;
  }
  if (task.status === "success") {
    return <CheckCircle2 size={12} className="text-emerald-400" />;
  }
  if (task.status === "error") {
    return <XCircle size={12} className="text-destructive" />;
  }
  return <Clock3 size={12} className="text-[hsl(var(--wb-text-muted))]" />;
}

export function TaskStatusCenter() {
  const { tasks, clearFinished, replacePersistentAgentTasks } = useTaskStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const [open, setOpen] = useState(false);
  const activeTasks = tasks.filter(
    (task) => task.status === "running" || task.status === "waiting",
  );
  const latestTask = useMemo(
    () =>
      activeTasks[activeTasks.length - 1] || tasks[tasks.length - 1] || null,
    [activeTasks, tasks]
  );
  const visibleTasks = [...tasks].reverse().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    void assistantTaskService
      .list(activeProjectId)
      .then((records) => {
        if (!cancelled) {
          replacePersistentAgentTasks(
            activeProjectId,
            records.map(assistantTaskToWorkbenchTask),
          );
        }
      })
      .catch((error) => {
        console.warn("Failed to load assistant task history", error);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, replacePersistentAgentTasks]);

  const handleClearFinished = () => {
    clearFinished();
    void assistantTaskService.clearFinished(activeProjectId).catch((error) => {
      console.warn("Failed to clear assistant task history", error);
    });
  };

  return (
    <div className="relative h-full">
      <button
        type="button"
        className={cn(
          "flex h-full items-center text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
          latestTask
            ? "min-w-[220px] max-w-[420px] gap-2 px-2"
            : "w-7 justify-center"
        )}
        onClick={() => setOpen((value) => !value)}
        title="Background Tasks"
        aria-label="Background Tasks"
      >
        {latestTask ? (
          <>
            {taskIcon(latestTask)}
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[hsl(var(--wb-text))]">
                {latestTask.title}
              </span>
              {latestTask.detail && (
                <span className="ml-1 text-[hsl(var(--wb-text-muted))]">
                  {latestTask.detail}
                </span>
              )}
            </span>
            {activeTasks.length > 1 && (
              <span className="rounded-[3px] bg-[hsl(var(--wb-active))] px-1 text-[10px] text-[hsl(var(--wb-text))]">
                {activeTasks.length}
              </span>
            )}
            <ChevronUp
              size={12}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </>
        ) : (
          <Bell size={12} />
        )}
      </button>

      {latestTask?.status === "running" && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden bg-[hsl(var(--wb-border-subtle))]">
          <span
            className={cn(
              "block h-full bg-[hsl(var(--wb-accent))]",
              latestTask.progress == null && "animate-[wb-progress-slide_1.2s_ease-in-out_infinite]"
            )}
            style={{
              width:
                latestTask.progress == null
                  ? "48%"
                  : `${Math.round(latestTask.progress * 100)}%`,
            }}
          />
        </span>
      )}

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-[420px] overflow-hidden rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] shadow-[0_18px_45px_rgba(0,0,0,0.36)]">
          <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-2 text-[11px]">
            <span className="font-semibold text-[hsl(var(--wb-text))]">
              Background Tasks
            </span>
            <button
              type="button"
              className="wb-icon-button"
              onClick={handleClearFinished}
              title="Clear finished tasks"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {visibleTasks.length > 0 ? (
              visibleTasks.map((task) => (
                <div
                  key={task.id}
                  className="grid grid-cols-[16px_1fr_auto] items-center gap-2 px-2 py-1.5 text-[11px] hover:bg-[hsl(var(--wb-hover))]"
                  title={task.error || task.detail || task.title}
                >
                  {taskIcon(task)}
                  <div className="min-w-0">
                    <div className="truncate text-[hsl(var(--wb-text))]">
                      {task.title}
                    </div>
                    {(task.error || task.detail) && (
                      <div className="truncate text-[hsl(var(--wb-text-muted))]">
                        {task.error || task.detail}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {taskStatusLabel(task)}
                  </span>
                </div>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
                No background tasks
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function taskStatusLabel(task: WorkbenchTask) {
  if (task.status === "running") return "running";
  if (task.status === "waiting") return "waiting";
  if (task.status === "interrupted") return "interrupted";
  return taskAge(task);
}
