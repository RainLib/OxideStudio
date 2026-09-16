import { afterEach, describe, expect, it, vi } from "vitest";
import { createCsvAnalysisClient } from "./csvAnalysisClient";
import type { CsvWorkerRequest, CsvWorkerResponse } from "./csvImportSession";

class WorkerStub {
  static latest: WorkerStub;
  onmessage?: (event: { data: CsvWorkerResponse }) => void;
  onerror?: () => void;
  postMessage = vi.fn<(request: CsvWorkerRequest) => void>();
  terminate = vi.fn();
  constructor() { WorkerStub.latest = this; }
}
describe("CSV worker transport lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("routes out-of-order replies to their own request and releases pending work on close", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    const bytes = new Uint8Array([1, 2]);
    const client = createCsvAnalysisClient(bytes);
    const worker = WorkerStub.latest;
    expect(worker.postMessage.mock.calls[0]?.[0]).toMatchObject({ type: "init", bytes });
    const first = client.rows(11);
    const second = client.rows(12);
    worker.onmessage?.({ data: { id: 2, value: [{ b: 2 }] } });
    worker.onmessage?.({ data: { id: 1, value: [{ a: 1 }] } });
    expect(await first).toEqual([{ a: 1 }]);
    expect(await second).toEqual([{ b: 2 }]);
    const pending = client.rows(13);
    const rejected = expect(pending).rejects.toThrow("closed");
    client.dispose();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(client.rows(14)).rejects.toThrow("closed");
  });
  it("settles in-flight work on a worker failure", async () => {
    vi.stubGlobal("Worker", WorkerStub);
    const client = createCsvAnalysisClient(new Uint8Array([1]));
    const pending = expect(client.rows(1)).rejects.toThrow("worker failed");
    WorkerStub.latest.onerror?.();
    await pending;
    expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
    client.dispose();
  });
});
