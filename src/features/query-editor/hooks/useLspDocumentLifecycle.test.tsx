// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Monaco } from "@monaco-editor/react";
import { getLspDocumentUri } from "@/services/lsp";
import {
  LSP_DOCUMENT_CHANGE_DEBOUNCE_MS,
  useLspDocumentLifecycle,
  type LspDocumentLifecycleClient,
} from "./useLspDocumentLifecycle";

type ControllerOptions = Parameters<typeof useLspDocumentLifecycle>[0];
type Controller = ReturnType<typeof useLspDocumentLifecycle>;

let root: Root;
let container: HTMLDivElement;
let controller: Controller;

function Harness(props: ControllerOptions) {
  controller = useLspDocumentLifecycle(props);
  return null;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function client(overrides: Partial<LspDocumentLifecycleClient> = {}) {
  return {
    didOpen: vi.fn().mockResolvedValue(undefined),
    didChange: vi.fn().mockResolvedValue(undefined),
    didClose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as LspDocumentLifecycleClient & {
    didOpen: ReturnType<typeof vi.fn>;
    didChange: ReturnType<typeof vi.fn>;
    didClose: ReturnType<typeof vi.fn>;
  };
}

async function renderController(options: ControllerOptions) {
  await act(async () => root.render(<Harness {...options} />));
}

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await act(async () => Promise.resolve());
    }
  }
}

const uriOne = getLspDocumentUri("tab-1", "postgresql", "sql");
const uriTwo = getLspDocumentUri("tab-2", "mysql", "sql");

describe("useLspDocumentLifecycle", () => {
  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("opens once and sends ordered changes for the active virtual document", async () => {
    const lspClient = client();
    const options: ControllerOptions = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController(options);
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));
    expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(true);
    expect(controller.documentVersionsRef.current.get(uriOne)).toBe(1);

    vi.useFakeTimers();
    await renderController({ ...options, activeDocumentText: "select 2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LSP_DOCUMENT_CHANGE_DEBOUNCE_MS);
    });
    await eventually(() => expect(lspClient.didChange).toHaveBeenCalledTimes(1));
    expect(lspClient.didChange).toHaveBeenCalledWith(uriOne, "select 2", 2);
    expect(controller.documentTextsRef.current.get(uriOne)).toBe("select 2");
  });

  it("coalesces rapid editor revisions into the latest LSP change", async () => {
    const lspClient = client();
    const options: ControllerOptions = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController(options);
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();

    await renderController({ ...options, activeDocumentText: "select 12" });
    await renderController({ ...options, activeDocumentText: "select 123" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LSP_DOCUMENT_CHANGE_DEBOUNCE_MS);
    });

    await eventually(() => expect(lspClient.didChange).toHaveBeenCalledTimes(1));
    expect(lspClient.didChange).toHaveBeenCalledWith(uriOne, "select 123", 2);
  });

  it("closes a late didOpen result after the editor context changes", async () => {
    const firstOpen = deferred();
    const lspClient = client({
      didOpen: vi
        .fn()
        .mockImplementationOnce(() => firstOpen.promise)
        .mockResolvedValue(undefined),
    });
    const tabs = [
      { id: "tab-1", type: "query" },
      { id: "tab-2", type: "query" },
    ];

    await renderController({
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lifecycleKey: "postgresql",
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs,
    });
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));

    await renderController({
      activeTabId: "tab-2",
      activeDocumentText: "select 2",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriTwo,
      lifecycleKey: "mysql",
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs,
    });
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(2));

    await act(async () => firstOpen.resolve(undefined));
    await eventually(() => expect(lspClient.didClose).toHaveBeenCalledWith(uriOne));
    expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(false);
    expect(controller.openedDocumentsRef.current.has(uriTwo)).toBe(true);
  });

  it("closes old session ownership before reopening in a new session", async () => {
    const firstClient = client();
    const secondClient = client();
    const base: Omit<ControllerOptions, "lspClient" | "lspSessionKey"> = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspReady: true,
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController({
      ...base,
      lspClient: firstClient,
      lspSessionKey: "session-1",
    });
    await eventually(() => expect(firstClient.didOpen).toHaveBeenCalledTimes(1));

    await renderController({
      ...base,
      lspClient: secondClient,
      lspSessionKey: "session-2",
    });
    await eventually(() => expect(firstClient.didClose).toHaveBeenCalledWith(uriOne));
    await eventually(() => expect(secondClient.didOpen).toHaveBeenCalledTimes(1));
  });

  it("serializes a remount behind cleanup of an in-flight didOpen", async () => {
    const firstOpen = deferred();
    const lspClient = client({
      didOpen: vi
        .fn()
        .mockImplementationOnce(() => firstOpen.promise)
        .mockResolvedValue(undefined),
    });
    const options: ControllerOptions = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-remount",
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController(options);
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));
    await act(async () => root.render(null));
    await renderController(options);
    expect(lspClient.didOpen).toHaveBeenCalledTimes(1);

    await act(async () => firstOpen.resolve(undefined));
    await eventually(() => expect(lspClient.didClose).toHaveBeenCalledWith(uriOne));
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(2));
  });

  it("closes removed tabs and clears their Monaco diagnostics", async () => {
    const lspClient = client();
    const model = {};
    const setModelMarkers = vi.fn();
    const monaco = {
      Uri: { parse: vi.fn(() => ({ uri: uriOne })) },
      editor: {
        getModel: vi.fn(() => model),
        setModelMarkers,
      },
    } as unknown as Monaco;

    await renderController({
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      monaco,
      tabs: [{ id: "tab-1", type: "query" }],
    });
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));

    await renderController({
      activeTabId: null,
      activeDocumentText: "",
      canUseLsp: false,
      documentLanguageId: "sql",
      documentUri: null,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      monaco,
      tabs: [],
    });
    await eventually(() => expect(lspClient.didClose).toHaveBeenCalledWith(uriOne));
    expect(setModelMarkers).toHaveBeenCalledWith(model, "sql-lsp", []);
  });
});
