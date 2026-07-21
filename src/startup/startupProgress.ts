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

const CORE_TASK_COUNT = 2;
const READY_VISIBILITY_MS = 300;
export const STARTUP_CORE_TASK_TIMEOUT_MS = 2_000;

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
    label: "Loading editor components in the background…",
  });
}

export function markWorkspaceShellInteractive() {
  if (snapshot.phase !== "workspace") return;
  update({
    phase: "ready",
    progress: 1,
    label: "Interface ready",
  });
  if (readyTimer) clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    readyTimer = null;
    update({ active: false });
  }, READY_VISIBILITY_MS);
}

function hydrationLabel(completedTasks: number) {
  if (completedTasks < CORE_TASK_COUNT) return "Loading projects and settings…";
  return "Workspace ready";
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

type SettledTask = { error?: unknown };

function startTask(task: () => Promise<void>): Promise<SettledTask> {
  try {
    return task().then(
      () => ({}),
      (error) => ({ error }),
    );
  } catch (error) {
    return Promise.resolve({ error });
  }
}

async function trackCoreTask(
  taskName: string,
  operation: Promise<SettledTask>,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SettledTask>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          error: new Error(
            `${taskName} is still loading and will continue in the background`,
          ),
        }),
      STARTUP_CORE_TASK_TIMEOUT_MS,
    );
  });
  const result = await Promise.race([operation, deadline]);
  if (timer) clearTimeout(timer);
  markTaskComplete(taskName, result.error);
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
    const projectOperation = startTask(tasks.loadProjects);
    const settingsOperation = startTask(tasks.loadSettings);

    const projectTask = trackCoreTask("projects", projectOperation);
    const settingsTask = trackCoreTask("settings", settingsOperation);

    // Connections are project-scoped, but they are data rather than workbench
    // chrome. Start them only after the real project operation settles and
    // never keep the workbench startup state waiting for them.
    void projectOperation.then(() => {
      void startTask(tasks.loadConnections);
    });

    await Promise.all([projectTask, settingsTask]);

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
