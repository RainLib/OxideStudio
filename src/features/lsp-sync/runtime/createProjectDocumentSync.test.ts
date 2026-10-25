import { describe, expect, it, vi } from "vitest";
import { createProjectDocumentSync } from "./createProjectDocumentSync";
import {createLspRuntimeObservation} from "@/services/lsp/client/runtimeObservation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function client(session = "session") {
  return {
    getSessionKey: vi.fn(() => session),
    didOpen: vi.fn(
      async (
        _uri: string,
        _content: string,
        _version: number,
        _language?: string,
      ) => {},
    ),
    didChange: vi.fn(
      async (_uri: string, _content: string, _version: number) => {},
    ),
    didClose: vi.fn(async (_uri: string) => {}),
  };
}
function request(lspClient = client(), content = "select 1") {
  return {
    activeProjectId: "project",
    lspClient,
    documents: [{ relativePath: "query.sql", content }],
    languageId: "sql",
  };
}

describe("project LSP document ownership", () => {
  it("reopens unchanged project content when the same client has a replacement process",async()=>{
    const process=createLspRuntimeObservation();process.setReady(true);const transport=Object.assign(client(),{getRuntimeSnapshot:process.getSnapshot}),session=createProjectDocumentSync();
    await session.synchronize(request(transport));process.setReady(true,true);await session.synchronize(request(transport));
    expect(transport.didOpen).toHaveBeenCalledTimes(2);expect(transport.didOpen.mock.calls.map(call=>call[2])).toEqual([1,1]);await session.closeAll();
  });
  it("does not mistake a replacement client with the same session name for the same transport",async()=>{
    const session=createProjectDocumentSync(),a=client(),b=client();await session.synchronize(request(a));await session.synchronize(request(b));
    expect(a.didClose).toHaveBeenCalledOnce();expect(b.didOpen).toHaveBeenCalledOnce();await session.closeAll();
  });
  it("closes an in-flight open before a new context can reopen the same document", async () => {
    const session = createProjectDocumentSync();
    const opening = deferred();
    const transport = client();
    transport.didOpen.mockImplementationOnce(() => opening.promise);
    const first = session.synchronize(request(transport));
    await vi.waitFor(()=>expect(transport.didOpen).toHaveBeenCalledOnce());
    const closing = session.closeAll();
    const next = session.synchronize(request(transport));
    opening.resolve();
    await Promise.all([first, closing, next]);
    expect(transport.didOpen).toHaveBeenCalledTimes(2);
    expect(transport.didClose).toHaveBeenCalledOnce();
    expect(transport.didClose.mock.invocationCallOrder[0]).toBeLessThan(
      transport.didOpen.mock.invocationCallOrder[1]!,
    );
    await session.closeAll();
    expect(transport.didClose).toHaveBeenCalledTimes(2);
  });

  it("deduplicates content and closes the former session before opening its replacement", async () => {
    const session = createProjectDocumentSync();
    const oldClient = client("old");
    const newClient = client("new");
    await session.synchronize(request(oldClient));
    await session.synchronize(request(oldClient));
    await session.synchronize(request(oldClient, "select 2"));
    expect(oldClient.didOpen).toHaveBeenCalledOnce();
    expect(oldClient.didChange).toHaveBeenCalledWith(
      expect.any(String),
      "select 2",
      2,
    );
    await session.synchronize(request(newClient));
    expect(oldClient.didClose).toHaveBeenCalledOnce();
    expect(newClient.didOpen).toHaveBeenCalledWith(
      expect.any(String),
      "select 1",
      1,
      "sql",
    );
    expect(oldClient.didClose.mock.invocationCallOrder[0]).toBeLessThan(
      newClient.didOpen.mock.invocationCallOrder[0]!,
    );
  });

  it("does not send a queued request after its metadata generation expires", async () => {
    const session = createProjectDocumentSync();
    const transport = client();
    let cancelled = false;
    const work = session.synchronize({
      ...request(transport),
      isCancelled: () => cancelled,
    });
    cancelled = true;
    await work;
    expect(transport.didOpen).not.toHaveBeenCalled();
  });

  it("keeps the queue usable after an open fails", async () => {
    const session = createProjectDocumentSync();
    const transport = client();
    transport.didOpen.mockRejectedValueOnce(new Error("Transport stopped"));
    await expect(session.synchronize(request(transport))).rejects.toThrow(
      "Transport stopped",
    );
    await session.synchronize(request(transport));
    expect(transport.didOpen).toHaveBeenCalledTimes(2);
    expect(transport.didClose).toHaveBeenCalledOnce();
  });

  it("closes a pending change once without restoring its cached document", async () => {
    const session = createProjectDocumentSync();
    const transport = client();
    await session.synchronize(request(transport));
    const changing = deferred();
    transport.didChange.mockImplementationOnce(() => changing.promise);
    const pending = session.synchronize(request(transport, "select 2"));
    await Promise.resolve();
    const closing = session.closeAll();
    changing.resolve();
    await Promise.all([pending, closing]);
    expect(transport.didClose).toHaveBeenCalledOnce();
    await session.synchronize(request(transport, "select 2"));
    expect(transport.didOpen).toHaveBeenCalledTimes(2);
  });
});
