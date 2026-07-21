/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStartupProgressSnapshot,
  markReactShellReady,
  markWorkspaceModuleReady,
  markWorkspaceShellInteractive,
  resetStartupProgressForTests,
  STARTUP_CORE_TASK_TIMEOUT_MS,
  startWorkspaceHydration,
} from "@/startup/startupProgress";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("startup progress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStartupProgressForTests();
  });

  afterEach(() => {
    resetStartupProgressForTests();
    vi.useRealTimers();
  });

  it("makes the workbench ready without waiting for project-scoped connections", async () => {
    const projects = deferred();
    const settings = deferred();
    const connections = deferred();
    const loadProjects = vi.fn(() => projects.promise);
    const loadSettings = vi.fn(() => settings.promise);
    const loadConnections = vi.fn(() => connections.promise);

    markReactShellReady();
    markWorkspaceModuleReady();
    const hydration = startWorkspaceHydration({
      loadProjects,
      loadSettings,
      loadConnections,
    });

    expect(loadProjects).toHaveBeenCalledOnce();
    expect(loadSettings).toHaveBeenCalledOnce();
    expect(loadConnections).not.toHaveBeenCalled();
    expect(getStartupProgressSnapshot()).toMatchObject({
      active: true,
      phase: "hydrating",
      progress: 0.35,
    });

    settings.resolve();
    await Promise.resolve();
    expect(loadConnections).not.toHaveBeenCalled();

    projects.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadConnections).toHaveBeenCalledOnce();

    await hydration;
    expect(getStartupProgressSnapshot()).toMatchObject({
      active: true,
      phase: "ready",
      progress: 1,
      label: "Workspace ready",
      completedTasks: 2,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(getStartupProgressSnapshot().active).toBe(false);
    connections.resolve();
  });

  it("finishes startup when a recoverable task rejects", async () => {
    await startWorkspaceHydration({
      loadProjects: vi.fn(async () => undefined),
      loadSettings: vi.fn(async () => {
        throw new Error("settings unavailable");
      }),
      loadConnections: vi.fn(async () => undefined),
    });

    expect(getStartupProgressSnapshot()).toMatchObject({
      phase: "ready",
      progress: 1,
      failedTasks: ["settings"],
      label: "Workspace ready — some data needs attention",
    });
  });

  it("treats the lightweight workbench shell as interactive", async () => {
    markReactShellReady();
    markWorkspaceModuleReady();
    markWorkspaceShellInteractive();

    expect(getStartupProgressSnapshot()).toMatchObject({
      phase: "ready",
      progress: 1,
      label: "Interface ready",
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(getStartupProgressSnapshot().active).toBe(false);
  });

  it("never leaves the workbench blocked by a startup task that does not settle", async () => {
    const projects = deferred();
    const settings = deferred();
    const loadConnections = vi.fn(async () => undefined);

    const hydration = startWorkspaceHydration({
      loadProjects: () => projects.promise,
      loadSettings: () => settings.promise,
      loadConnections,
    });

    await vi.advanceTimersByTimeAsync(STARTUP_CORE_TASK_TIMEOUT_MS);
    await hydration;

    expect(getStartupProgressSnapshot()).toMatchObject({
      phase: "ready",
      progress: 1,
      completedTasks: 2,
      failedTasks: ["projects", "settings"],
    });
    expect(loadConnections).not.toHaveBeenCalled();

    projects.resolve();
    settings.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(loadConnections).toHaveBeenCalledOnce();
  });
});
