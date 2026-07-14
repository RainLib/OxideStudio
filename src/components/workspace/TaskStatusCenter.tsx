import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronUp,
  Clock3,
  Loader2,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTaskStore, type WorkbenchTask } from "@/store/useTaskStore";
import { useProjectStore } from "@/store/useProjectStore";
import { assistantTaskService } from "@/services/tauri/assistant-task.service";
import { assistantTaskToWorkbenchTask } from "@/lib/assistantTaskProjection";
import { useTaskNavigationStore } from "@/lib/taskNavigation";
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
  const taskRevealRequest = useTaskNavigationStore((state) => state.request);
  const clearTaskReveal = useTaskNavigationStore((state) => state.clear);
  const [open, setOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const activeTasks = tasks.filter(
    (task) => task.status === "running" || task.status === "waiting",
  );
  const latestTask = useMemo(
    () =>
      activeTasks[activeTasks.length - 1] || tasks[tasks.length - 1] || null,
    [activeTasks, tasks]
  );
  const visibleTasks = [...tasks].reverse().slice(0, 10);
  const selectedTask = selectedTaskId
    ? tasks.find(
        (task) =>
          task.id === selectedTaskId &&
          (!task.projectId || task.projectId === activeProjectId),
      ) || null
    : null;

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

  useEffect(() => {
    if (!taskRevealRequest) return;
    const { id, target } = taskRevealRequest;
    if (target.projectId !== activeProjectId) return;
    setOpen(true);
    setSelectedTaskId(target.taskId ?? null);
    clearTaskReveal(id);
  }, [activeProjectId, clearTaskReveal, taskRevealRequest]);

  useEffect(() => {
    setSelectedTaskId(null);
  }, [activeProjectId]);

  const handleClearFinished = () => {
    clearFinished();
    if (
      selectedTask &&
      selectedTask.status !== "running" &&
      selectedTask.status !== "waiting"
    ) {
      setSelectedTaskId(null);
    }
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
            {selectedTask ? (
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5 text-[hsl(var(--wb-text))] hover:text-[hsl(var(--wb-accent))]"
                onClick={() => setSelectedTaskId(null)}
              >
                <ChevronLeft size={12} />
                <span className="truncate font-semibold">Task details</span>
              </button>
            ) : (
              <>
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
              </>
            )}
          </div>
          <div className="max-h-80 overflow-auto">
            {selectedTask ? (
              <TaskDetails task={selectedTask} />
            ) : visibleTasks.length > 0 ? (
              <div className="py-1">
                {visibleTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="grid w-full grid-cols-[16px_1fr_auto] items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-[hsl(var(--wb-hover))]"
                    title={task.error || task.detail || task.title}
                    onClick={() => setSelectedTaskId(task.id)}
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
                  </button>
                ))}
              </div>
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

function TaskDetails({ task }: { task: WorkbenchTask }) {
  const hasUncertainExecution = task.steps?.some(
    (step) => step.status === "uncertain",
  );
  return (
    <div className="px-3 py-3 text-[11px]" data-task-id={task.id}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{taskIcon(task)}</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[hsl(var(--wb-text))]">
            {task.title}
          </div>
          <div className="mt-0.5 text-[10px] text-[hsl(var(--wb-text-muted))]">
            {task.detail || taskStatusLabel(task)}
          </div>
        </div>
        <span className="rounded-[3px] bg-[hsl(var(--wb-active))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--wb-text))]">
          {task.status}
        </span>
      </div>

      {task.progress != null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[9px] text-[hsl(var(--wb-text-muted))]">
            <span>Progress</span>
            <span>{Math.round(task.progress * 100)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[hsl(var(--wb-border-subtle))]">
            <div
              className="h-full bg-[hsl(var(--wb-accent))]"
              style={{ width: `${Math.round(task.progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {hasUncertainExecution && (
        <div className="mt-3 rounded-[4px] border border-amber-400/30 bg-amber-400/8 px-2 py-1.5 text-[9px] leading-4 text-amber-200">
          An approved action may have reached the target before this task
          stopped. Verify the database or external system before creating a new
          action; this step will not be replayed automatically.
        </div>
      )}

      <div className="mt-3 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
        <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--wb-text-muted))]">
          Recorded steps
        </div>
        {task.steps && task.steps.length > 0 ? (
          <div className="space-y-0.5">
            {task.steps.map((step) => (
              <div
                key={step.id}
                className="grid grid-cols-[14px_1fr_auto] items-start gap-2 rounded-[3px] px-1 py-1.5 hover:bg-[hsl(var(--wb-hover)/0.58)]"
              >
                <span className="mt-0.5">{taskStepIcon(step.status)}</span>
                <div className="min-w-0">
                  <div className="truncate text-[10px] text-[hsl(var(--wb-text))]">
                    {step.title}
                  </div>
                  {step.toolName && (
                    <div className="truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]">
                      {step.toolName}
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                  {stepStatusLabel(step.status)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-3 text-center text-[10px] text-[hsl(var(--wb-text-muted))]">
            No recorded steps
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-[hsl(var(--wb-border-subtle))] pt-2 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        Safe summary only. Prompts, SQL, tool payloads, result rows, and approval
        tokens are not stored.
      </div>
    </div>
  );
}

function taskStepIcon(status: NonNullable<WorkbenchTask["steps"]>[number]["status"]) {
  if (status === "running") {
    return <Loader2 size={11} className="animate-spin text-[hsl(var(--wb-accent))]" />;
  }
  if (status === "success") {
    return <CheckCircle2 size={11} className="text-emerald-400" />;
  }
  if (status === "requiresApproval" || status === "uncertain") {
    return <ShieldAlert size={11} className="text-amber-300" />;
  }
  if (status === "error") {
    return <XCircle size={11} className="text-destructive" />;
  }
  return <Clock3 size={11} className="text-[hsl(var(--wb-text-muted))]" />;
}

function stepStatusLabel(
  status: NonNullable<WorkbenchTask["steps"]>[number]["status"],
) {
  if (status === "requiresApproval") return "approval";
  if (status === "uncertain") return "verify";
  return status;
}

function taskStatusLabel(task: WorkbenchTask) {
  if (task.status === "running") return "running";
  if (task.status === "waiting") return "waiting";
  if (task.status === "interrupted") return "interrupted";
  return taskAge(task);
}
