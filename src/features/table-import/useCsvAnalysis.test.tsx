// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCsvAnalysis } from "./useCsvAnalysis";
import type { CsvAnalysisOptions } from "./csvImportSession";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("./csvAnalysisClient", () => ({ createCsvAnalysisClient: mocks.createClient }));
const options: CsvAnalysisOptions = {
  encoding: "auto", delimiter: "auto", titleRow: 1, dataStartRow: 2, lastDataRow: 0,
  columns: [], mapping: [], emptyAsNull: true, trimValues: false,
};

describe("CSV analysis state", () => {
  afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
  it("retains a source error when options change and clears it when the file closes", async () => {
    mocks.createClient.mockImplementation(() => { throw new Error("worker unavailable"); });
    const root = createRoot(document.createElement("div"));
    let current!: ReturnType<typeof useCsvAnalysis>;
    function Probe({ bytes, delimiter }: { bytes: Uint8Array | null; delimiter: string }) {
      current = useCsvAnalysis(bytes, { ...options, delimiter });
      return null;
    }
    const bytes = new Uint8Array([1]);
    try {
      await act(async () => { root.render(<Probe bytes={bytes} delimiter="auto" />); });
      expect(current.error).toContain("worker unavailable");
      await act(async () => { root.render(<Probe bytes={bytes} delimiter="," />); });
      expect(current.isAnalyzing).toBe(false);
      expect(current.error).toContain("worker unavailable");
      await act(async () => { root.render(<Probe bytes={null} delimiter="," />); });
      expect(current.error).toBeNull();
      expect(current.analysis).toBeNull();
    } finally { root.unmount(); }
  });

  it("rejects a row transfer if the review closes before it completes", async () => {
    vi.useFakeTimers();
    let completeRows!: (value: Array<Record<string, unknown>>) => void;
    const dispose = vi.fn();
    mocks.createClient.mockReturnValue({
      analyze: vi.fn(async () => ({ revision: 1, value: { rowCount: 1 } })),
      rows: vi.fn(() => new Promise((resolve) => { completeRows = resolve; })),
      dispose,
    });
    const root = createRoot(document.createElement("div"));
    let current!: ReturnType<typeof useCsvAnalysis>;
    function Probe({ bytes }: { bytes: Uint8Array | null }) {
      current = useCsvAnalysis(bytes, options);
      return null;
    }
    try {
      await act(async () => { root.render(<Probe bytes={new Uint8Array([1])} />); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60); });
      expect(current.analysis?.rowCount).toBe(1);
      const result = current.rows().then((value) => ({ value }), (error: Error) => ({ error: error.message }));
      await act(async () => { root.render(<Probe bytes={null} />); });
      await act(async () => { completeRows([{ id: 1 }]); });
      expect(await result).toEqual({ error: "CSV review changed before submission." });
      expect(dispose).toHaveBeenCalledOnce();
      expect(current.analysis).toBeNull();
    } finally { root.unmount(); }
  });
});
