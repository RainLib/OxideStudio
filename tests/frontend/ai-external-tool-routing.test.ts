import { describe, expect, it, vi } from "vitest";
import { createCliToolAdapter } from "@/ai/cli/adapter";
import { createMcpProtocolAdapter } from "@/ai/mcp/protocol";
import { registerCoreAiTools } from "@/ai/tools/coreTools";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { createAiToolRegistry } from "@/ai/tools/registry";
import type { AiToolAdapters } from "@/ai/tools/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

function createDatabaseToolHarness() {
  const adapters: AiToolAdapters = {
    listConnections: vi.fn(() => [
      { id: "pg-1", name: "Postgres", driver: "postgres" },
    ]),
    getConnectionCapabilities: vi.fn((driver) =>
      defaultDatabaseCapabilities(driver)
    ),
    listObjects: vi.fn((input, context) => [
      {
        name: "users",
        namespace: input.namespace || context.activeNamespace || "public",
        kind: "relation",
        type: "BASE TABLE",
      },
    ]),
    describeObject: vi.fn((input, context) => ({
      connectionId: input.connectionId || context.activeConnectionId || "pg-1",
      namespace: input.namespace || context.activeNamespace || "public",
      name: input.name,
      driver: context.activeDriver || "postgres",
      kind: "relation",
      columns: [
        {
          name: "id",
          data_type: "integer",
          is_nullable: false,
          is_primary_key: true,
        },
      ],
      indexes: [],
      constraints: [],
      previewQuery: 'SELECT * FROM "public"."users" LIMIT 100;',
      deleteQuery: null,
    })),
    runReadOnlyQuery: vi.fn((input) => [
      {
        columns: [{ name: "id", data_type: "integer" }],
        rows: [[1]],
        row_count: 1,
        execution_time_ms: 1,
        rows_affected: 0,
        query: input.query,
      },
    ]),
    mutateTableRows: vi.fn(() => ({
      inserted: 1,
      updated: 0,
      deleted: 0,
      rowsAffected: 1,
    })),
  };
  const registry = registerCoreAiTools(createAiToolRegistry(), adapters);
  const createContext = () => ({
    requestId: "external-agent-test",
    activeConnectionId: "pg-1",
    activeDriver: "postgres" as const,
    activeNamespace: "public",
  });

  return { adapters, registry, createContext };
}

describe("external AI database tool routing", () => {
  it("routes CLI reads and rejects caller self-approval for mutations", async () => {
    const { adapters, registry, createContext } = createDatabaseToolHarness();
    const cli = createCliToolAdapter({
      registry,
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const metadata = await cli.run([
      "tools",
      "call",
      "metadata.listObjects",
      "--json",
      '{"namespace":"public"}',
    ]);
    const query = await cli.run([
      "tools",
      "call",
      "query.runReadOnly",
      "--json",
      '{"query":"SELECT * FROM users","limit":5}',
    ]);
    const mutation = await cli.run([
      "tools",
      "call",
      "table.insertRows",
      "--approve",
      "--json",
      '{"table":"users","namespace":"public","inserts":[{"id":1}]}',
    ]);

    expect(metadata.exitCode).toBe(0);
    expect(JSON.parse(metadata.stdout)).toEqual([
      expect.objectContaining({ name: "users", namespace: "public" }),
    ]);
    expect(query.exitCode).toBe(0);
    expect(JSON.parse(query.stdout)).toEqual([
      expect.objectContaining({ row_count: 1, query: "SELECT * FROM users" }),
    ]);
    expect(mutation.exitCode).toBe(1);
    expect(mutation.stderr).toContain("not a valid authorization");

    expect(adapters.listObjects).toHaveBeenCalledWith(
      { connectionId: null, namespace: "public" },
      expect.objectContaining({ activeConnectionId: "pg-1" })
    );
    expect(adapters.runReadOnlyQuery).toHaveBeenCalledWith(
      {
        connectionId: "pg-1",
        query: "SELECT * FROM users",
        limit: 5,
      },
      expect.objectContaining({ activeNamespace: "public" })
    );
    expect(adapters.mutateTableRows).not.toHaveBeenCalled();
  });

  it("routes MCP tool calls with context overrides through the same database adapters", async () => {
    const { adapters, registry, createContext } = createDatabaseToolHarness();
    const protocol = createMcpProtocolAdapter({
      registry,
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const response = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "metadata.describeObject",
        arguments: { name: "users" },
        _meta: {
          "oxide/context": {
            activeConnectionId: "pg-reporting",
            activeDriver: "postgres",
            activeNamespace: "reporting",
          },
        },
      },
    });
    const result = response && "result" in response
      ? (response.result as { content: Array<{ text: string }> })
      : null;

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(JSON.parse(result?.content[0]?.text || "{}")).toMatchObject({
      connectionId: "pg-reporting",
      namespace: "reporting",
      name: "users",
      kind: "relation",
    });
    expect(adapters.describeObject).toHaveBeenCalledWith(
      { connectionId: null, namespace: null, name: "users" },
      expect.objectContaining({
        activeConnectionId: "pg-reporting",
        activeNamespace: "reporting",
      })
    );
  });
});
