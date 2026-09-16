import {
  CsvImportSession, type CsvAnalysis, type CsvAnalysisOptions,
  type CsvWorkerRequest, type CsvWorkerResponse,
} from "./csvImportSession";

export function createCsvAnalysisClient(bytes: Uint8Array) {
  let sequence = 0;
  let disposed = false;
  let worker: Worker | undefined;
  let fallback: CsvImportSession | undefined;
  const pending = new Map<number, { resolve(value: NonNullable<CsvWorkerResponse["value"]>): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    pending.forEach((request) => request.reject(error));
    pending.clear();
  };
  try {
    worker = new Worker(new URL("../../workers/csvImport.worker.ts", import.meta.url),
      { type: "module", name: "oxide-csv-import" });
    worker.onmessage = ({ data }: MessageEvent<CsvWorkerResponse>) => {
      const request = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) request?.reject(new Error(data.error));
      else if (data.value) request?.resolve(data.value);
    };
    worker.onerror = () => {
      disposed = true;
      worker?.terminate();
      fail(new Error("CSV worker failed. Reopen the file or use the streaming importer."));
    };
    const copy = bytes.slice();
    worker.postMessage({ type: "init", bytes: copy } satisfies CsvWorkerRequest, [copy.buffer]);
  } catch {
    worker?.terminate();
    worker = undefined;
    // Small browser/test sources remain usable without blocking on large files.
    if (bytes.byteLength > 256 * 1024) throw new Error("CSV worker is unavailable. Use Import delimited text (streaming)… for this file.");
    fallback = new CsvImportSession(bytes);
  }
  const send = (request: Exclude<CsvWorkerRequest, { type: "init" }>) =>
    new Promise<NonNullable<CsvWorkerResponse["value"]>>((resolve, reject) => {
      if (disposed) { reject(new Error("CSV review closed.")); return; }
      if (fallback) {
        try {
          resolve(request.type === "analyze"
            ? fallback.analyze(request.id, request.options) : fallback.rows(request.revision));
        } catch (error) { reject(error); }
      } else {
        pending.set(request.id, { resolve, reject });
        try { worker!.postMessage(request); }
        catch (error) { pending.delete(request.id); reject(error); }
      }
    });
  return {
    analyze(options: CsvAnalysisOptions) {
      const revision = ++sequence;
      return send({ type: "analyze", id: revision, options })
        .then((value) => ({ revision, value: value as CsvAnalysis }));
    },
    rows(revision: number) {
      return send({ type: "rows", id: ++sequence, revision }) as Promise<Array<Record<string, unknown>>>;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      fail(new Error("CSV review closed."));
    },
  };
}
