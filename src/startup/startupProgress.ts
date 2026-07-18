import { useSyncExternalStore } from "react";

export type StartupProgressPhase =
  | "shell"
  | "workspace"
  | "hydrating"
  | "ready";

export interface StartupProgressSnapshot {
  active: boolean;
  phase: StartupProgressPhase;
  progress: number;
  label: string;
  completedTasks: number;
  totalTasks: number;
  failedTasks: string[];
}

export interface WorkspaceHydrationTasks {
  loadProjects: () => Promise<void>;
  loadSettings: () => Promise<void>;
  loadConnections: () => Promise<void>;
}

const CORE_TASK_COUNT = 3;
const READY_VISIBILITY_MS = 300;

const initialSnapshot = (): StartupProgressSnapshot => ({
  active: true,
  phase: "shell",
  progress: 0.12,
  label: "Opening workspace…",
  completedTasks: 0,
  totalTasks: CORE_TASK_COUNT,
  failedTasks: [],
});

let snapshot = initialSnapshot();
let hydrationPromise: Promise<void> | null = null;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: StartupProgressSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function update(patch: Partial<StartupProgressSnapshot>) {
  publish({ ...snapshot, ...patch });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStartupProgressSnapshot() {
  return snapshot;
}

export function useStartupProgress() {
  return useSyncExternalStore(
    subscribe,
    getStartupProgressSnapshot,
    getStartupProgressSnapshot,
  );
}

export function markReactShellReady() {
  if (snapshot.phase !== "shell") return;
  update({
    progress: Math.max(snapshot.progress, 0.2),
    label: "Loading workspace…",
  });
}

export function markWorkspaceModuleReady() {
  if (snapshot.phase === "hydrating" || snapshot.phase === "ready") return;
  update({
    phase: "workspace",
    progress: Math.max(snapshot.progress, 0.3),
    label: "Preparing workspace…",
  });
}

function hydrationLabel(completedTasks: number) {
  if (completedTasks < 2) return "Loading projects and settings…";
  return "Loading data sources…";
}

function markTaskComplete(taskName: string, error?: unknown) {
  const completedTasks = Math.min(
    CORE_TASK_COUNT,
    snapshot.completedTasks + 1,
  );
  const failedTasks = error
    ? [...snapshot.failedTasks, taskName]
    : snapshot.failedTasks;
  update({
    completedTasks,
    failedTasks,
    progress: 0.35 + (completedTasks / CORE_TASK_COUNT) * 0.65,
    label: hydrationLabel(completedTasks),
  });
}

async function runTask(taskName: string, task: () => Promise<void>) {
  try {
    await task();
    markTaskComplete(taskName);
  } catch (error) {
    // Startup data is recoverable and individual stores expose their own
    // retry/error states. A rejected task must never block the workbench.
    markTaskComplete(taskName, error);
  }
}

export function startWorkspaceHydration(tasks: WorkspaceHydrationTasks) {
  if (hydrationPromise) return hydrationPromise;

  update({
    active: true,
    phase: "hydrating",
    progress: Math.max(snapshot.progress, 0.35),
    label: "Loading projects and settings…",
    completedTasks: 0,
    totalTasks: CORE_TASK_COUNT,
    failedTasks: [],
  });

  hydrationPromise = (async () => {
    const projectTask = runTask("projects", tasks.loadProjects);
    const settingsTask = runTask("settings", tasks.loadSettings);

    // Connections are project-scoped. Wait for project canonicalization before
    // reading them so a saved project cannot briefly show another project's
    // data sources during startup.
    await projectTask;
    const connectionTask = runTask("data sources", tasks.loadConnections);
    await Promise.all([settingsTask, connectionTask]);

    update({
      active: true,
      phase: "ready",
      progress: 1,
      label:
        snapshot.failedTasks.length > 0
          ? "Workspace ready — some data needs attention"
          : "Workspace ready",
    });

    readyTimer = setTimeout(() => {
      readyTimer = null;
      update({ active: false });
    }, READY_VISIBILITY_MS);
  })();

  return hydrationPromise;
}

export function resetStartupProgressForTests() {
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = null;
  hydrationPromise = null;
  publish(initialSnapshot());
}
