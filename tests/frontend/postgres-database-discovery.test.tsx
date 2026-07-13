/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  usePostgresDatabaseDiscovery,
  type PostgresDatabaseDiscoveryState,
} from "@/hooks/usePostgresDatabaseDiscovery";
import type {
  PostgresDatabaseCatalogIdentity,
  PostgresDatabaseCatalogSnapshot,
} from "@/services/postgresDatabaseCatalogCache";

const mocks = vi.hoisted(() => ({
  readCachedCatalog: vi.fn(),
  refreshCatalog: vi.fn(),
  subscribeCatalog: vi.fn(() => () => undefined),
}));

vi.mock("@/services/postgresDatabaseCatalogCache", () => ({
  readCachedPostgresDatabaseCatalog: mocks.readCachedCatalog,
  refreshPostgresDatabaseCatalog: mocks.refreshCatalog,
  subscribePostgresDatabaseCatalog: mocks.subscribeCatalog,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type DiscoveryOptions = Parameters<typeof usePostgresDatabaseDiscovery>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function cacheSnapshot(databases: string[]): PostgresDatabaseCatalogSnapshot {
  return { databases, source: "cache", updatedAt: 1 };
}

function remoteSnapshot(databases: string[]): PostgresDatabaseCatalogSnapshot {
  return { databases, source: "remote", updatedAt: 2 };
}

function identity(
  projectId: string,
  connectionId = "shared-connection"
): PostgresDatabaseCatalogIdentity {
  return { projectId, connectionId, driver: "postgres" };
}

describe("usePostgresDatabaseDiscovery", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let observedState: PostgresDatabaseDiscoveryState | null;

  function Harness(options: DiscoveryOptions) {
    observedState = usePostgresDatabaseDiscovery(options);
    return null;
  }

  async function render(options: DiscoveryOptions) {
    await act(async () => {
      if (!root) root = createRoot(container);
      root.render(<Harness {...options} />);
      for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
      }
    });
  }

  async function flushUpdates() {
    await act(async () => {
      for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
      }
    });
  }

  function state() {
    if (!observedState) throw new Error("Discovery state was not rendered");
    return observedState;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    observedState = null;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  it("hydrates the project-scoped SQLite cache before the connection is ready", async () => {
    const cached = deferred<PostgresDatabaseCatalogSnapshot | null>();
    mocks.readCachedCatalog.mockReturnValueOnce(cached.promise);

    await render({
      projectId: "project-a",
      connectionId: "connection-1",
      driver: "postgres",
      isConnectionReady: false,
      refreshVersion: 0,
    });

    expect(mocks.readCachedCatalog).toHaveBeenCalledWith(
      identity("project-a", "connection-1")
    );
    expect(mocks.refreshCatalog).not.toHaveBeenCalled();

    cached.resolve(cacheSnapshot(["app", "analytics"]));
    await flushUpdates();

    expect(state()).toMatchObject({
      connectionId: "connection-1",
      status: "success",
      databases: ["app", "analytics"],
      source: "cache",
      isRefreshing: false,
      cacheLoaded: true,
    });
    expect(mocks.refreshCatalog).not.toHaveBeenCalled();
  });

  it("keeps cached rows usable while a slow remote refresh is pending", async () => {
    const remote = deferred<PostgresDatabaseCatalogSnapshot>();
    mocks.readCachedCatalog.mockResolvedValueOnce(
      cacheSnapshot(["app", "analytics"])
    );
    mocks.refreshCatalog.mockReturnValueOnce(remote.promise);

    await render({
      projectId: "project-a",
      connectionId: "connection-1",
      driver: "postgres",
      isConnectionReady: true,
      refreshVersion: 0,
    });

    expect(mocks.refreshCatalog).toHaveBeenCalledWith(
      identity("project-a", "connection-1")
    );
    expect(state()).toMatchObject({
      status: "success",
      databases: ["app", "analytics"],
      source: "cache",
      isRefreshing: true,
      cacheLoaded: true,
    });
  });

  it("preserves cached rows when the remote refresh fails", async () => {
    const remote = deferred<PostgresDatabaseCatalogSnapshot>();
    mocks.readCachedCatalog.mockResolvedValueOnce(
      cacheSnapshot(["app", "analytics"])
    );
    mocks.refreshCatalog.mockReturnValueOnce(remote.promise);

    await render({
      projectId: "project-a",
      connectionId: "connection-1",
      driver: "postgres",
      isConnectionReady: true,
      refreshVersion: 0,
    });

    remote.reject(new Error("network unavailable"));
    await flushUpdates();

    expect(state()).toMatchObject({
      status: "success",
      databases: ["app", "analytics"],
      source: "cache",
      error: "network unavailable",
      isRefreshing: false,
      cacheLoaded: true,
    });
  });

  it("ignores a late response after switching projects with the same connection id", async () => {
    const projectARemote = deferred<PostgresDatabaseCatalogSnapshot>();
    const projectBRemote = deferred<PostgresDatabaseCatalogSnapshot>();
    const projectBCache = deferred<PostgresDatabaseCatalogSnapshot | null>();
    mocks.readCachedCatalog.mockImplementation(
      (catalogIdentity: PostgresDatabaseCatalogIdentity) =>
        catalogIdentity.projectId === "project-a"
          ? Promise.resolve(cacheSnapshot(["app", "analytics"]))
          : projectBCache.promise
    );
    mocks.refreshCatalog.mockImplementation(
      (catalogIdentity: PostgresDatabaseCatalogIdentity) =>
        catalogIdentity.projectId === "project-a"
          ? projectARemote.promise
          : projectBRemote.promise
    );

    const sharedOptions = {
      connectionId: "shared-connection",
      driver: "postgres" as const,
      isConnectionReady: true,
      refreshVersion: 0,
    };
    await render({ projectId: "project-a", ...sharedOptions });
    expect(state().databases).toEqual(["app", "analytics"]);

    await render({ projectId: "project-b", ...sharedOptions });
    expect(state()).toMatchObject({
      connectionId: "shared-connection",
      databases: [],
      source: null,
      isRefreshing: false,
      cacheLoaded: false,
    });
    expect(mocks.refreshCatalog).not.toHaveBeenCalledWith(identity("project-b"));

    projectBCache.resolve(cacheSnapshot(["app", "warehouse"]));
    await flushUpdates();
    expect(state()).toMatchObject({
      connectionId: "shared-connection",
      databases: ["app", "warehouse"],
      source: "cache",
      isRefreshing: true,
    });

    projectARemote.resolve(remoteSnapshot(["app", "project_a_only"]));
    await flushUpdates();

    expect(state()).toMatchObject({
      databases: ["app", "warehouse"],
      source: "cache",
      isRefreshing: true,
    });
    expect(mocks.readCachedCatalog).toHaveBeenCalledWith(identity("project-a"));
    expect(mocks.readCachedCatalog).toHaveBeenCalledWith(identity("project-b"));
    expect(mocks.refreshCatalog).toHaveBeenCalledWith(identity("project-a"));
    expect(mocks.refreshCatalog).toHaveBeenCalledWith(identity("project-b"));
  });

  it("atomically replaces cached rows after a successful refresh", async () => {
    const remote = deferred<PostgresDatabaseCatalogSnapshot>();
    mocks.readCachedCatalog.mockResolvedValueOnce(
      cacheSnapshot(["app", "analytics"])
    );
    mocks.refreshCatalog.mockReturnValueOnce(remote.promise);

    await render({
      projectId: "project-a",
      connectionId: "connection-1",
      driver: "postgres",
      isConnectionReady: true,
      refreshVersion: 0,
    });
    expect(state()).toMatchObject({
      databases: ["app", "analytics"],
      source: "cache",
      isRefreshing: true,
    });

    remote.resolve(remoteSnapshot(["app", "warehouse"]));
    await flushUpdates();

    expect(state()).toEqual({
      connectionId: "connection-1",
      status: "success",
      databases: ["app", "warehouse"],
      error: null,
      source: "remote",
      isRefreshing: false,
      cacheLoaded: true,
    });
  });
});
