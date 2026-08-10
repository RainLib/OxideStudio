import { beforeEach, describe, expect, it, vi } from "vitest";
import { LspClient } from "@/services/lsp/client";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("LSP client", () => {
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
