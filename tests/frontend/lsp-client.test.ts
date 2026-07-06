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
});
