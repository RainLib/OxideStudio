import { beforeEach, describe, expect, it, vi } from "vitest";
import { LspClient } from "@/services/lsp/client";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("LSP client", () => {
  it("propagates document transport failures so a lifecycle cannot commit a failed revision", async () => {
    const client = new LspClient("document:fixture"); mocks.invoke.mockResolvedValueOnce("initialized");
    await client.initialize("/fixture/sql-lsp");
    mocks.invoke.mockRejectedValueOnce(new Error("open transport failed"));
    await expect(client.didOpen("oxide-file-query://project/file.sql", "SELECT 1", 1, "sql")).rejects.toThrow("open transport failed");
    mocks.invoke.mockRejectedValueOnce(new Error("change transport failed"));
    await expect(client.didChange("oxide-file-query://project/file.sql", "SELECT 2", 2)).rejects.toThrow("change transport failed");
  });
  it("keeps default format fallback while allowing callers to require real success", async () => {
    const client = new LspClient("document:format-errors");
    await expect(client.formatDocument("fixture.sql", 2, true, true)).rejects.toThrow("not ready");
    mocks.invoke.mockResolvedValueOnce("initialized"); await client.initialize("/fixture/sql-lsp");
    mocks.invoke.mockRejectedValueOnce(new Error("default failure"));
    await expect(client.formatDocument("fixture.sql", 2, true)).resolves.toEqual([]);
    mocks.invoke.mockRejectedValueOnce(new Error("strict failure"));
    await expect(client.formatDocument("fixture.sql", 2, true, true)).rejects.toThrow("strict failure");
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends schema configuration through the Tauri LSP command", async () => {
    const client = new LspClient();
    const config = {
      defaultDialect: "postgres",
      schemas: [
        {
          id: "schema-public",
          database: "public",
          source_uri: null,
          tables: [],
          functions: [],
        },
      ],
      fileSchemas: {
        "oxide://query/q.postgres.postgres": "schema-public",
      },
      fileDialects: {
        "oxide://query/q.postgres.postgres": "postgres",
      },
    };

    mocks.invoke.mockResolvedValueOnce("initialized");
    mocks.invoke.mockResolvedValueOnce("configuration accepted");

    await client.initialize("/tmp/sql-lsp");
    await client.updateConfiguration(config);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "lsp_initialize", {
      request: { binary_path: "/tmp/sql-lsp" },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      "lsp_did_change_configuration",
      {
        settings: config,
      }
    );
  });

  it("does not dispatch configuration before initialization", async () => {
    const client = new LspClient();

    await client.updateConfiguration({
      defaultDialect: "postgres",
      schemas: [],
      fileSchemas: {},
      fileDialects: {},
    });

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("routes advanced editor requests through the strict generic bridge", async () => {
    const client = new LspClient("postgres:connection-1");
    mocks.invoke
      .mockResolvedValueOnce("initialized")
      .mockResolvedValueOnce({
        signatures: [{ label: "calculate(value numeric)" }],
      })
      .mockResolvedValueOnce({ data: [0, 0, 6, 3, 0] })
      .mockResolvedValueOnce([
        {
          position: { line: 0, character: 10 },
          label: "value:",
          kind: 2,
        },
      ]);

    await client.initialize("/tmp/sql-lsp");
    await client.getSignatureHelp("file:///query.sql", 0, 10);
    await client.getSemanticTokens("file:///query.sql");
    await client.getInlayHints("file:///query.sql", {
      start: { line: 0, character: 0 },
      end: { line: 1, character: 0 },
    });

    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "lsp_request", {
      request: {
        session_key: "postgres:connection-1",
        method: "textDocument/signatureHelp",
        params: {
          textDocument: { uri: "file:///query.sql" },
          position: { line: 0, character: 10 },
        },
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "lsp_request", {
      request: {
        session_key: "postgres:connection-1",
        method: "textDocument/semanticTokens/full",
        params: { textDocument: { uri: "file:///query.sql" } },
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "lsp_request", {
      request: {
        session_key: "postgres:connection-1",
        method: "textDocument/inlayHint",
        params: {
          textDocument: { uri: "file:///query.sql" },
          range: {
            start: { line: 0, character: 0 },
            end: { line: 1, character: 0 },
          },
        },
      },
    });
  });

  it("round-trips lazy completion data through the scoped resolve command", async () => {
    const client = new LspClient("postgres:connection-1");
    const unresolved = {
      label: "customer_id",
      kind: 5,
      data: { symbol: 42 },
    };
    mocks.invoke
      .mockResolvedValueOnce("initialized")
      .mockResolvedValueOnce({
        items: [unresolved],
        isIncomplete: true,
        resolveProvider: true,
      })
      .mockResolvedValueOnce({
        ...unresolved,
        detail: "customers.customer_id bigint",
      });

    await client.initialize("/tmp/sql-lsp");
    const list = await client.getCompletionList("file:///query.sql", 1, 7, {
      triggerKind: 1,
    });
    const resolved = await client.resolveCompletionItem(list.items[0]!);

    expect(list).toEqual({
      items: [unresolved],
      isIncomplete: true,
      resolveProvider: true,
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "lsp_resolve_completion", {
      request: {
        session_key: "postgres:connection-1",
        item: unresolved,
        request_token: expect.any(String),
      },
    });
    expect(resolved).toMatchObject({
      label: "customer_id",
      detail: "customers.customer_id bigint",
      data: { symbol: 42 },
    });
  });
});


describe("process incarnation observation",()=>{
  it("changes its opaque generation on actual initialize, disconnect, restart and shutdown",async()=>{
    mocks.invoke.mockReset();const client=new LspClient("file-query:runtime"),listener=vi.fn(),release=client.subscribeRuntime(listener),initial=client.getRuntimeSnapshot();
    mocks.invoke.mockResolvedValueOnce("initialized");await client.initialize("/fixture/sql-lsp");const first=client.getRuntimeSnapshot();expect(first.ready).toBe(true);expect(first.generation).not.toBe(initial.generation);
    client.markDisconnected();const closed=client.getRuntimeSnapshot();expect(closed.ready).toBe(false);expect(closed.generation).not.toBe(first.generation);
    mocks.invoke.mockResolvedValueOnce("initialized");await client.initialize("/fixture/sql-lsp");expect(client.getRuntimeSnapshot().generation).not.toBe(first.generation);
    mocks.invoke.mockResolvedValueOnce("shutdown");await client.shutdown();expect(client.getRuntimeSnapshot().ready).toBe(false);expect(listener).toHaveBeenCalledTimes(4);release();
  });
  it("keeps a stable snapshot for an already-running process and repeated disconnected observations",async()=>{
    mocks.invoke.mockReset();const client=new LspClient("file-query:stable");mocks.invoke.mockResolvedValueOnce("initialized");await client.initialize("/fixture/sql-lsp");const snapshot=client.getRuntimeSnapshot(),listener=vi.fn();client.subscribeRuntime(listener);
    mocks.invoke.mockResolvedValueOnce(true);await client.initialize("/fixture/sql-lsp");expect(client.getRuntimeSnapshot()).toBe(snapshot);expect(listener).not.toHaveBeenCalled();
    client.markDisconnected();const closed=client.getRuntimeSnapshot();client.markDisconnected();expect(client.getRuntimeSnapshot()).toBe(closed);expect(listener).toHaveBeenCalledOnce();
  });
  it("does not announce readiness or reuse a grant when initialization fails",async()=>{
    mocks.invoke.mockReset();const client=new LspClient("file-query:failed"),snapshot=client.getRuntimeSnapshot(),listener=vi.fn();client.subscribeRuntime(listener);
    mocks.invoke.mockRejectedValueOnce(new Error("cannot initialize"));await expect(client.initialize("/fixture/sql-lsp")).rejects.toThrow("cannot initialize");expect(client.getRuntimeSnapshot()).toBe(snapshot);expect(listener).not.toHaveBeenCalled();
  });
});

it("rejects a receipt from a previous process after the same client restarts",async()=>{
  mocks.invoke.mockReset();mocks.invoke.mockResolvedValueOnce("initialized");const client=new LspClient("receipt:restart");await client.initialize("/fixture/sql-lsp");
  let resolve!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const pending=client.confirmAnalysisConfiguration("current");
  client.markDisconnected();mocks.invoke.mockResolvedValueOnce("initialized");await client.initialize("/fixture/sql-lsp");resolve({applied:true,oxideAnalysisToken:"current"});
  expect(await pending).toBe(false);
});
it("accepts configuration confirmation only for the current running client",async()=>{
  mocks.invoke.mockReset();const client=new LspClient("receipt:current");expect(await client.confirmAnalysisConfiguration("current")).toBe(false);expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.invoke.mockResolvedValueOnce("initialized");await client.initialize("/fixture/sql-lsp");mocks.invoke.mockResolvedValueOnce({applied:true,oxideAnalysisToken:"current"});
  expect(await client.confirmAnalysisConfiguration("current")).toBe(true);
});
