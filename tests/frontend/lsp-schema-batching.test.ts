import { describe, expect, it, vi } from "vitest";
import { loadLspMetadataInBatches } from "@/services/lsp/schemaBatching";

describe("LSP schema metadata batching", () => {
  it("loads catalogs larger than the former limits with bounded concurrency", async () => {
    const items = Array.from({ length: 620 }, (_, index) => index);
    const loaded: number[] = [];
    let active = 0;
    let maxActive = 0;
    const yieldToMain = vi.fn(async () => undefined);

    const result = await loadLspMetadataInBatches({
      items,
      batchSize: 50,
      concurrency: 7,
      yieldToMain,
      load: async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return item * 2;
      },
      onBatch: (batch) => loaded.push(...batch),
    });

    expect(result).toEqual({
      status: "complete",
      processed: 620,
      total: 620,
      batches: 13,
    });
    expect(loaded).toEqual(items.map((item) => item * 2));
    expect(maxActive).toBeLessThanOrEqual(7);
    expect(yieldToMain).toHaveBeenCalledTimes(12);
  });

  it("stops before scheduling another batch when a sync becomes stale", async () => {
    const load = vi.fn(async (item: number) => item);
    let cancelled = false;

    const result = await loadLspMetadataInBatches({
      items: Array.from({ length: 120 }, (_, index) => index),
      batchSize: 25,
      concurrency: 5,
      isCancelled: () => cancelled,
      yieldToMain: async () => undefined,
      load,
      onBatch: () => {
        cancelled = true;
      },
    });

    expect(result).toEqual({
      status: "cancelled",
      processed: 25,
      total: 120,
      batches: 1,
    });
    expect(load).toHaveBeenCalledTimes(25);
  });

  it("does not publish a partially completed batch after cancellation", async () => {
    let cancelled = false;
    const onBatch = vi.fn();

    const result = await loadLspMetadataInBatches({
      items: Array.from({ length: 40 }, (_, index) => index),
      batchSize: 40,
      concurrency: 4,
      isCancelled: () => cancelled,
      load: async (item) => {
        if (item === 2) cancelled = true;
        await Promise.resolve();
        return item;
      },
      onBatch,
    });

    expect(result.status).toBe("cancelled");
    expect(result.processed).toBe(0);
    expect(onBatch).not.toHaveBeenCalled();
  });
});
