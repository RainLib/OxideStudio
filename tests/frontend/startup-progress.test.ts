/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStartupProgressSnapshot,
  markReactShellReady,
  markWorkspaceModuleReady,
  resetStartupProgressForTests,
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

  it("loads settings in parallel but waits for the active project before connections", async () => {
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

    connections.resolve();
    await hydration;
    expect(getStartupProgressSnapshot()).toMatchObject({
      active: true,
      phase: "ready",
      progress: 1,
      label: "Workspace ready",
      completedTasks: 3,
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(getStartupProgressSnapshot().active).toBe(false);
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
});
