/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listCliModels: vi.fn(),
  listCliCommands: vi.fn(),
  listCliEfforts: vi.fn(),
  environmentRevision: "environment-1",
  environmentListeners: new Set<(provider: string, profileId: string) => void>(),
}));

vi.mock("@/services/tauri/ai.service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/services/tauri/ai.service")>();
  return {
    ...original,
    aiService: {
      ...original.aiService,
      listCliModels: mocks.listCliModels,
      listCliCommands: mocks.listCliCommands,
      listCliEfforts: mocks.listCliEfforts,
      getCliEnvironmentRevision: () => mocks.environmentRevision,
      subscribeCliEnvironmentRevision: (
        listener: (provider: string, profileId: string) => void,
      ) => {
        mocks.environmentListeners.add(listener);
        return () => mocks.environmentListeners.delete(listener);
      },
    },
  };
});

import {
  resetAiCliCatalogForTests,
  useAiCliCatalog,
  type AiCliCatalogController,
} from "@/hooks/useAiCliCatalog";
import type { AiCliProviderConfig } from "@/services/tauri/ai.service";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_CONFIG: AiCliProviderConfig = {
  kind: "codex-cli",
  profileId: "codex-cli:default",
  executablePath: "/opt/oxide/bin/codex",
  model: "default",
  reasoningEffort: "default",
  timeoutMs: 30_000,
  environmentKeys: ["HTTPS_PROXY"],
};

let currentCatalog: AiCliCatalogController | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function CatalogProbe({
  config,
  enabled = true,
  runtimeVersion = "codex 1.0.0",
}: {
  config: AiCliProviderConfig;
  enabled?: boolean;
  runtimeVersion?: string;
}) {
  currentCatalog = useAiCliCatalog(config, enabled, runtimeVersion);
  return (
    <output
      data-status={currentCatalog.status}
      data-model-count={currentCatalog.models.length}
    />
  );
}

describe("useAiCliCatalog cache", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let now = 1_000_000;

  beforeEach(() => {
    resetAiCliCatalogForTests();
    currentCatalog = null;
    mocks.listCliModels.mockReset().mockResolvedValue([
      {
        id: "default",
        label: "Default",
        isDefault: true,
      },
    ]);
    mocks.listCliCommands.mockReset().mockResolvedValue([
      { name: "status", description: "Show status" },
    ]);
    mocks.listCliEfforts.mockReset().mockResolvedValue([]);
    mocks.environmentRevision = "environment-1";
    mocks.environmentListeners.clear();
    now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    container.remove();
    resetAiCliCatalogForTests();
    vi.restoreAllMocks();
  });

  it("reuses a settled catalog after the consuming component remounts", async () => {
    root = createRoot(container);
    await render(root, <CatalogProbe config={{ ...BASE_CONFIG }} />);

    expect(currentCatalog?.status).toBe("ready");
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);
    expect(mocks.listCliModels).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "codex-cli" }),
      { runtimeVersion: "codex 1.0.0", forceRefresh: false },
    );
    expect(mocks.listCliCommands).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "codex-cli" }),
      { runtimeVersion: "codex 1.0.0", forceRefresh: false },
    );

    await act(async () => root?.unmount());
    root = createRoot(container);
    await render(root, <CatalogProbe config={{ ...BASE_CONFIG }} />);

    expect(currentCatalog?.status).toBe("ready");
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);
  });

  it("does not refetch models when only the command capability failed", async () => {
    mocks.listCliCommands.mockRejectedValue(new Error("commands unavailable"));
    root = createRoot(container);
    await render(root, <CatalogProbe config={BASE_CONFIG} />);

    expect(currentCatalog?.status).toBe("ready");
    expect(currentCatalog?.warning).toContain(
      "Command catalog: commands unavailable",
    );

    await act(async () => root?.unmount());
    root = createRoot(container);
    await render(root, <CatalogProbe config={{ ...BASE_CONFIG }} />);

    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);

    now += 31_000;
    await act(async () => root?.unmount());
    root = createRoot(container);
    await render(root, <CatalogProbe config={{ ...BASE_CONFIG }} />);

    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(2);
  });

  it("forces both catalog resources to refresh on explicit refresh", async () => {
    root = createRoot(container);
    await render(root, <CatalogProbe config={BASE_CONFIG} />);

    await act(async () => {
      currentCatalog?.refresh();
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(2);
    expect(mocks.listCliModels).toHaveBeenLastCalledWith(
      expect.any(Object),
      { runtimeVersion: "codex 1.0.0", forceRefresh: true },
    );
    expect(mocks.listCliCommands).toHaveBeenLastCalledWith(
      expect.any(Object),
      { runtimeVersion: "codex 1.0.0", forceRefresh: true },
    );
  });

  it("does not let refresh during initial discovery reuse the non-forced in-flight requests", async () => {
    const initialModels = deferred<
      Array<{ id: string; label: string; isDefault: boolean }>
    >();
    const initialCommands = deferred<
      Array<{ name: string; description: string }>
    >();
    const initialEfforts = deferred<string[]>();
    mocks.listCliModels
      .mockReset()
      .mockReturnValueOnce(initialModels.promise)
      .mockResolvedValueOnce([
        { id: "refreshed", label: "Refreshed", isDefault: false },
      ]);
    mocks.listCliCommands
      .mockReset()
      .mockReturnValueOnce(initialCommands.promise)
      .mockResolvedValueOnce([
        { name: "status", description: "Refreshed status" },
      ]);
    mocks.listCliEfforts
      .mockReset()
      .mockReturnValueOnce(initialEfforts.promise)
      .mockResolvedValueOnce(["high"]);
    root = createRoot(container);
    await render(
      root,
      <CatalogProbe
        config={{
          ...BASE_CONFIG,
          kind: "codebuddy-cli",
          profileId: "codebuddy-cli:default",
          model: "hy-3",
        }}
        runtimeVersion="codebuddy 2.0.0"
      />,
    );

    await act(async () => {
      currentCatalog?.refresh();
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(1);
    expect(mocks.listCliEfforts).toHaveBeenCalledTimes(1);

    await act(async () => {
      initialModels.resolve([
        { id: "initial", label: "Initial", isDefault: false },
      ]);
      initialCommands.resolve([
        { name: "initial", description: "Initial command" },
      ]);
      initialEfforts.resolve(["medium"]);
      await flushAsyncWork();
    });

    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);
    expect(mocks.listCliCommands).toHaveBeenCalledTimes(2);
    expect(mocks.listCliEfforts).toHaveBeenCalledTimes(2);
    for (const request of [
      mocks.listCliModels,
      mocks.listCliCommands,
      mocks.listCliEfforts,
    ]) {
      expect(request).toHaveBeenLastCalledWith(
        expect.any(Object),
        { runtimeVersion: "codebuddy 2.0.0", forceRefresh: true },
      );
    }
  });

  it("forces CodeBuddy effort refreshes and retains the last good effort list on failure", async () => {
    mocks.listCliEfforts
      .mockResolvedValueOnce(["medium", "high"])
      .mockRejectedValueOnce(new Error("effort refresh unavailable"));
    root = createRoot(container);
    await render(
      root,
      <CatalogProbe
        config={{
          ...BASE_CONFIG,
          kind: "codebuddy-cli",
          profileId: "codebuddy-cli:default",
          model: "hy-3",
        }}
        runtimeVersion="codebuddy 2.0.0"
      />,
    );
    expect(currentCatalog?.efforts).toEqual(["medium", "high"]);
    expect(mocks.listCliEfforts).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "hy-3" }),
      { runtimeVersion: "codebuddy 2.0.0", forceRefresh: false },
    );

    await act(async () => {
      currentCatalog?.refresh();
      await flushAsyncWork();
    });

    expect(currentCatalog?.efforts).toEqual(["medium", "high"]);
    expect(currentCatalog?.effortStatus).toBe("ready");
    expect(currentCatalog?.effortWarning).toContain("effort refresh unavailable");
    expect(mocks.listCliEfforts).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "hy-3" }),
      { runtimeVersion: "codebuddy 2.0.0", forceRefresh: true },
    );
  });

  it("keys capabilities by provider identity, environment, and runtime version", async () => {
    root = createRoot(container);
    await render(
      root,
      <CatalogProbe config={BASE_CONFIG} runtimeVersion="codex 1.0.0" />,
    );

    await render(
      root,
      <CatalogProbe
        config={{
          ...BASE_CONFIG,
          model: "gpt-next",
          reasoningEffort: "high",
          serviceTier: "priority",
          timeoutMs: 90_000,
          environmentKeys: ["HTTPS_PROXY"],
        }}
        runtimeVersion="codex 1.0.0"
      />,
    );
    expect(mocks.listCliModels).toHaveBeenCalledTimes(1);

    await render(
      root,
      <CatalogProbe config={BASE_CONFIG} runtimeVersion="codex 1.1.0" />,
    );
    expect(mocks.listCliModels).toHaveBeenCalledTimes(2);

    await render(
      root,
      <CatalogProbe
        config={{ ...BASE_CONFIG, executablePath: "/other/codex" }}
        runtimeVersion="codex 1.1.0"
      />,
    );
    expect(mocks.listCliModels).toHaveBeenCalledTimes(3);

    await render(
      root,
      <CatalogProbe
        config={{ ...BASE_CONFIG, profileId: "codex-cli:work" }}
        runtimeVersion="codex 1.1.0"
      />,
    );
    expect(mocks.listCliModels).toHaveBeenCalledTimes(4);

    await render(
      root,
      <CatalogProbe config={BASE_CONFIG} runtimeVersion="codex 1.0.0" />,
    );
    expect(mocks.listCliModels).toHaveBeenCalledTimes(4);

    mocks.environmentRevision = "environment-2";
    await act(async () => {
      for (const listener of [...mocks.environmentListeners]) {
        listener("codex-cli", "codex-cli:default");
      }
      await flushAsyncWork();
    });
    expect(mocks.listCliModels).toHaveBeenCalledTimes(5);
  });
});

async function render(root: Root, element: ReactNode) {
  await act(async () => {
    root.render(element);
    await flushAsyncWork();
  });
}

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}
