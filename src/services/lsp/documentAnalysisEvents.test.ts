import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { subscribeDocumentAnalysis } from "./documentAnalysisEvents";
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn()
}));
const uri = "oxide://refresh/test.sql";
function fixture(pending = false) {
  let handler!: (event: {
    payload: unknown;
  }) => void;
  let ready!: (cleanup: () => void) => void;
  const cleanup = vi.fn(),
    onPublication = vi.fn();
  vi.mocked(listen).mockImplementation((_event, callback) => {
    handler = callback as typeof handler;
    return pending ? new Promise(resolve => {
      ready = resolve;
    }) : Promise.resolve(cleanup);
  });
  const subscription = subscribeDocumentAnalysis({
    sessionKey: "one",
    documentUri: uri,
    onPublication
  });
  return {
    subscription,
    cleanup,
    onPublication,
    ready: () => ready(cleanup),
    emit: (payload: unknown) => handler({
      payload
    })
  };
}
const payload = (version: unknown = 4) => ({
  sessionKey: "one",
  method: "textDocument/publishDiagnostics",
  params: {
    uri,
    diagnostics: [],
    version
  }
});
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
describe("scoped LSP analysis publications", () => {
  it("accepts matching versioned publications including zero", () => {
    const f = fixture();
    f.emit(payload());
    f.emit(payload(0));
    expect(f.onPublication.mock.calls).toEqual([[{
      version: 4
    }], [{
      version: 0
    }]]);
    f.subscription.dispose();
  });
  it("rejects another session, unscoped messages, another URI and other methods", () => {
    const f = fixture();
    for (const value of [{
      ...payload(),
      sessionKey: "two"
    }, {
      ...payload(),
      sessionKey: undefined
    }, {
      ...payload(),
      method: "workspace/refresh"
    }, {
      ...payload(),
      params: {
        uri: uri + "x",
        diagnostics: []
      }
    }]) f.emit(value);
    expect(f.onPublication).not.toHaveBeenCalled();
    f.subscription.dispose();
  });
  it("rejects malformed envelopes and invalid version values", () => {
    const f = fixture();
    for (const value of [null, [], {}, {
      ...payload(),
      params: null
    }, {
      ...payload(),
      params: {
        uri,
        diagnostics: {}
      }
    }, ...[-1, 0.5, "4", null, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1].map(payload)]) f.emit(value);
    expect(f.onPublication).not.toHaveBeenCalled();
    f.subscription.dispose();
  });
  it("passes an unversioned publication without inventing a model version", () => {
    const f = fixture();
    f.emit({
      ...payload(),
      params: {
        uri,
        diagnostics: []
      }
    });
    expect(f.onPublication).toHaveBeenCalledWith({
      version: undefined
    });
    f.subscription.dispose();
  });
  it("releases a listener that finishes registering after disposal", async () => {
    const f = fixture(true);
    f.subscription.dispose();
    f.emit(payload());
    f.ready();
    await Promise.resolve();
    expect(f.onPublication).not.toHaveBeenCalled();
    expect(f.cleanup).toHaveBeenCalledTimes(1);
  });
  it("cleans up once and rejects retained callbacks after disposal", async () => {
    const f = fixture();
    await Promise.resolve();
    f.subscription.dispose();
    f.subscription.dispose();
    f.emit(payload());
    expect(f.cleanup).toHaveBeenCalledTimes(1);
    expect(f.onPublication).not.toHaveBeenCalled();
  });
  it("handles a failed native listener registration", async () => {
    const error = new Error("listener unavailable"),
      report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(listen).mockRejectedValue(error);
    const subscription = subscribeDocumentAnalysis({
      sessionKey: "one",
      documentUri: uri,
      onPublication: vi.fn()
    });
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(expect.any(String), error);
    subscription.dispose();
  });
  it("does not report a late registration failure after disposal", async () => {
    let reject!: (error: unknown) => void;
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(listen).mockImplementation(() => new Promise((_resolve, fail) => {
      reject = fail;
    }));
    const subscription = subscribeDocumentAnalysis({
      sessionKey: "one",
      documentUri: uri,
      onPublication: vi.fn()
    });
    subscription.dispose();
    reject(new Error("closed"));
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });
  it("passes only a bounded ASCII configuration token from the actual notification",()=>{
    const f=fixture();f.emit({...payload(),params:{...payload().params,oxideAnalysisToken:"config-123"}});
    expect(f.onPublication).toHaveBeenCalledWith({version:4,analysisToken:"config-123"});f.subscription.dispose();
  });
  it("rejects malformed token extensions instead of granting a current context",()=>{
    const f=fixture();for(const token of [null,1,"", "K", "x".repeat(129),"SQL;value"])
      f.emit({...payload(),params:{...payload().params,oxideAnalysisToken:token}});
    expect(f.onPublication).not.toHaveBeenCalled();f.subscription.dispose();
  });
});
