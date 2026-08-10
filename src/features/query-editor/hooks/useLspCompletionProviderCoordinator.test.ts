import { describe, expect, it, vi } from "vitest";
import {
  registerLspCompletionProvider,
  type MonacoCompletionProvider,
  type MonacoCompletionResolver,
} from "./useLspCompletionProviderCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fixture() {
  let provider: any;
  let command: ((...args: any[]) => void) | undefined;
  const providerDispose = vi.fn();
  const commandDispose = vi.fn();
  const monaco = {
    editor: {
      registerCommand: vi.fn((_id: string, handler: (...args: any[]) => void) => {
        command = handler;
        return { dispose: commandDispose };
      }),
    },
    languages: {
      registerCompletionItemProvider: vi.fn(
        (_language: string, nextProvider: any) => {
          provider = nextProvider;
          return { dispose: providerDispose };
        },
      ),
    },
  };
  const usage = vi.fn();
  const triggerChainedCompletion = vi.fn();
  let runtime = {
    ownerKey: "owner-1",
    provideCompletionItems: vi.fn(async () => ({
      suggestions: [{ label: "SELECT" }],
    })) as MonacoCompletionProvider,
    resolveCompletionItem: vi.fn(async (item) => item) as MonacoCompletionResolver,
    rankByUsage: true,
    recordUsage: usage,
    triggerChainedCompletion,
    usageScope: "scope-1",
  };
  const coordinator = registerLspCompletionProvider({
    editorLanguageId: "pgsql",
    getRuntime: () => runtime,
    monaco,
    triggerCharacters: [" ", "."],
    usageCommandId: "oxide.recordCompletion",
  });
  return {
    command: () => command!,
    commandDispose,
    coordinator,
    monaco,
    provider: () => provider,
    providerDispose,
    runtime: () => runtime,
    setRuntime: (next: typeof runtime) => {
      runtime = next;
    },
    triggerChainedCompletion,
    usage,
  };
}

describe("LSP completion provider coordinator", () => {
  it("registers and disposes the provider and usage command together", () => {
    const state = fixture();

    expect(
      state.monaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledWith(
      "pgsql",
      expect.objectContaining({ triggerCharacters: [" ", "."] }),
    );
    state.coordinator.dispose();
    expect(state.commandDispose).toHaveBeenCalledTimes(1);
    expect(state.providerDispose).toHaveBeenCalledTimes(1);
  });

  it("reopens suggestions after a chained completion is accepted", () => {
    const state = fixture();

    state.command()({}, "scope-1", "public", true);
    expect(state.triggerChainedCompletion).toHaveBeenCalledTimes(1);

    state.command()({}, "stale-scope", "archive", true);
    expect(state.triggerChainedCompletion).toHaveBeenCalledTimes(1);

    state.command()({}, "scope-1", "private", true, "stale-owner");
    expect(state.triggerChainedCompletion).toHaveBeenCalledTimes(1);
  });

  it("uses current usage settings without provider re-registration", () => {
    const state = fixture();
    state.command()({}, "scope-1", "SELECT");
    expect(state.usage).toHaveBeenCalledWith("scope-1", "SELECT");

    state.setRuntime({
      ...state.runtime(),
      rankByUsage: false,
    });
    state.command()({}, "scope-1", "FROM");
    expect(state.usage).not.toHaveBeenCalledWith("scope-1", "FROM");
    expect(
      state.monaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledTimes(1);
  });

  it("drops a completion response after its owner changes", async () => {
    const state = fixture();
    const response = deferred<{ suggestions: any[] }>();
    state.setRuntime({
      ...state.runtime(),
      provideCompletionItems: vi.fn(() => response.promise),
    });
    const pending = state
      .provider()
      .provideCompletionItems({}, {}, {}, { isCancellationRequested: false });

    state.setRuntime({ ...state.runtime(), ownerKey: "owner-2" });
    response.resolve({ suggestions: [{ label: "stale" }] });
    await expect(pending).resolves.toEqual({ suggestions: [] });
  });

  it("drops lazy completion enrichment after its owner changes", async () => {
    const state = fixture();
    const response = deferred<any>();
    state.setRuntime({
      ...state.runtime(),
      resolveCompletionItem: vi.fn(() => response.promise),
    });
    const original = { label: "customer_id" };
    const pending = state
      .provider()
      .resolveCompletionItem(original, { isCancellationRequested: false });

    state.setRuntime({ ...state.runtime(), ownerKey: "owner-2" });
    response.resolve({ ...original, detail: "stale detail" });
    await expect(pending).resolves.toBe(original);
  });
});
