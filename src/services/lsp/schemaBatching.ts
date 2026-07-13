export type LspMetadataBatchResult = {
  status: "complete" | "cancelled";
  processed: number;
  total: number;
  batches: number;
};

export const DEFAULT_LSP_METADATA_BATCHING = {
  batchSize: 32,
  concurrency: 8,
} as const;

export type LspMetadataBatchOptions<T, R> = {
  items: readonly T[];
  batchSize: number;
  concurrency: number;
  load: (item: T, index: number) => Promise<R>;
  onBatch: (results: R[], startIndex: number) => void | Promise<void>;
  isCancelled?: () => boolean;
  yieldToMain?: () => Promise<void>;
};

/**
 * Loads an unbounded metadata collection without launching an unbounded number
 * of Tauri commands. Cancellation cannot abort commands already in flight, but
 * it prevents new work from starting and prevents a completed stale batch from
 * being published.
 */
export async function loadLspMetadataInBatches<T, R>(
  options: LspMetadataBatchOptions<T, R>
): Promise<LspMetadataBatchResult> {
  const batchSize = positiveInteger(options.batchSize);
  const concurrency = positiveInteger(options.concurrency);
  const isCancelled = options.isCancelled || (() => false);
  const yieldToMain = options.yieldToMain || defaultYieldToMain;
  let processed = 0;
  let batches = 0;

  while (processed < options.items.length) {
    if (isCancelled()) {
      return cancelledResult(processed, options.items.length, batches);
    }

    const batch = options.items.slice(processed, processed + batchSize);
    const results = await mapBatchWithConcurrency({
      items: batch,
      startIndex: processed,
      concurrency,
      load: options.load,
      isCancelled,
    });

    if (!results || isCancelled()) {
      return cancelledResult(processed, options.items.length, batches);
    }

    await options.onBatch(results, processed);
    processed += results.length;
    batches += 1;

    if (processed < options.items.length) {
      await yieldToMain();
    }
  }

  return {
    status: "complete",
    processed,
    total: options.items.length,
    batches,
  };
}

async function mapBatchWithConcurrency<T, R>(options: {
  items: readonly T[];
  startIndex: number;
  concurrency: number;
  load: (item: T, index: number) => Promise<R>;
  isCancelled: () => boolean;
}): Promise<R[] | null> {
  const results: Array<{ value: R } | undefined> = new Array(
    options.items.length
  );
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(options.concurrency, options.items.length) },
    async () => {
      while (!options.isCancelled()) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= options.items.length) return;

        const value = await options.load(
          options.items[index]!,
          options.startIndex + index
        );
        results[index] = { value };
      }
    }
  );

  await Promise.all(workers);
  if (options.isCancelled() || results.some((result) => !result)) return null;
  return results.map((result) => result!.value);
}

function positiveInteger(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function cancelledResult(
  processed: number,
  total: number,
  batches: number
): LspMetadataBatchResult {
  return { status: "cancelled", processed, total, batches };
}

function defaultYieldToMain() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
