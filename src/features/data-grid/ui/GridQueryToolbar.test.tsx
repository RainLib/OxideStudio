// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "@/services/tauri/types/query";
import { useGridQueryToolbar } from "../hooks/useGridQueryToolbar";
import { GridQueryToolbar } from "./GridQueryToolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const copy = vi.fn(async () => undefined);
const exportResult = vi.fn();
const result: QueryResult = {
  columns: [{ name: "id", data_type: "int" }],
  rows: [[1]],
};

function Harness({ data = result }: { data?: QueryResult }) {
  const [isTransposed, setTransposed] = useState(false);
  const toolbar = useGridQueryToolbar({ activeTab: null, result: data, isTransposed });
  return (
    <GridQueryToolbar
      {...toolbar}
      isTransposed={isTransposed}
      sourceResult={data}
      result={data}
      activeTab={null}
      isActiveResultExecuting={false}
      loadMoreNativeQueryPage={async () => false}
      setQueryResultTransposed={setTransposed}
      handleCopyAll={copy}
      handleExport={exportResult}
    />
  );
}

describe("query result toolbar overflow", () => {
  let root: Root;
  let host: HTMLDivElement;
  let dimensions: { client: number; scroll: number };
  let frames: Map<number, FrameRequestCallback>;
  let resize: Set<() => void>;
  let mutations: Set<() => void>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    dimensions = { client: 600, scroll: 500 };
    frames = new Map();
    resize = new Set();
    mutations = new Set();
    copy.mockClear();
    exportResult.mockClear();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: () => void) {}
      observe() { resize.add(this.callback); }
      disconnect() { resize.delete(this.callback); }
    });
    vi.stubGlobal("MutationObserver", class {
      constructor(private callback: () => void) {}
      observe() { mutations.add(this.callback); }
      disconnect() { mutations.delete(this.callback); }
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function flushFrames() {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  }

  async function mount() {
    await act(async () => root.render(<Harness />));
    const toolbar = host.firstElementChild as HTMLDivElement;
    Object.defineProperties(toolbar, {
      clientWidth: { get: () => dimensions.client },
      scrollWidth: { get: () => dimensions.scroll },
    });
    await flushFrames();
    return toolbar;
  }

  it("compacts on resize and waits for enough width before expanding again", async () => {
    const toolbar = await mount();
    expect(toolbar.hasAttribute("data-compact")).toBe(false);
    dimensions.client = 480;
    await act(async () => resize.forEach((measure) => measure()));
    expect(toolbar.dataset.compact).toBe("true");

    dimensions.scroll = 350;
    dimensions.client = 490;
    await act(async () => resize.forEach((measure) => measure()));
    expect(toolbar.dataset.compact).toBe("true");

    dimensions.client = 520;
    await act(async () => resize.forEach((measure) => measure()));
    expect(toolbar.hasAttribute("data-compact")).toBe(false);
  });

  it("remeasures changed result content and disconnects when unmounted", async () => {
    const toolbar = await mount();
    await act(async () => root.render(<Harness data={{ ...result, rows: [[1], [2]] }} />));
    dimensions.scroll = 650;
    await act(async () => mutations.forEach((measure) => measure()));
    expect(toolbar.dataset.compact).toBe("true");
    await act(async () => root.unmount());
    expect(resize.size).toBe(0);
    expect(mutations.size).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("keeps icon actions labelled and usable in compact mode", async () => {
    dimensions = { client: 380, scroll: 600 };
    const toolbar = await mount();
    const copyButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="Copy result as TSV"]')!;
    const exportButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="Export query result"]')!;
    const transposeButton = toolbar.querySelector<HTMLButtonElement>('[aria-label="Transpose result"]')!;
    expect(copyButton.disabled).toBe(false);
    expect(exportButton.disabled).toBe(false);
    expect(copyButton.textContent).not.toContain("Copy");
    expect(exportButton.textContent).not.toContain("Export");
    await act(async () => copyButton.click());
    expect(copy).toHaveBeenCalledOnce();
    await act(async () => transposeButton.click());
    await flushFrames();
    expect(toolbar.querySelector('[aria-label="Show standard result grid"]')?.getAttribute("aria-pressed")).toBe("true");
  });
});
