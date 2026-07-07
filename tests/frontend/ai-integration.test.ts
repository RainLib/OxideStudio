import { describe, expect, it } from "vitest";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import {
  createAssistantPlannerGraph,
  createLangGraphAssistantPlanner,
} from "@/ai/assistant/langGraphPlanner";
import {
  createModelAssistantPlanner,
  createModelToolResultSummarizer,
  type AssistantModelPlannerRequest,
  type AssistantModelResultSummaryRequest,
} from "@/ai/assistant/modelPlanner";
import { createCliToolAdapter } from "@/ai/cli/adapter";
import { createMcpProtocolAdapter } from "@/ai/mcp/protocol";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { createAiToolRegistry } from "@/ai/tools/registry";
import type { AiToolExecutionContext } from "@/ai/tools/types";

function createTestRegistry() {
  const registry = createAiToolRegistry();

  registry.register({
    name: "demo.read",
    description: "Read a bounded demo value.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    execute: async (input, context) => ({ input, mode: "read", context }),
  });

  registry.register({
    name: "demo.write",
    description: "Write a demo value after approval.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      additionalProperties: false,
    },
    permissions: ["write"],
    capabilities: ["query"],
    execute: async (input) => ({ input, mode: "write" }),
  });

  return registry;
}

function createPlannerRegistry() {
  const registry = createAiToolRegistry();

  registry.register({
    name: "query.runReadOnly",
    description: "Run a read-only query.",
    inputSchema: { type: "object", additionalProperties: true },
    permissions: ["read"],
    capabilities: ["query"],
    execute: async (input) => ({ input }),
  });

  registry.register({
    name: "key.getValue",
    description: "Read a Redis key.",
    inputSchema: { type: "object", additionalProperties: true },
    permissions: ["read"],
    capabilities: ["query"],
    execute: async (input) => ({ input }),
  });

  return registry;
}

function createContext(): AiToolExecutionContext {
  return {
    requestId: "test-request",
    activeConnectionId: "connection-1",
    activeDriver: "postgres",
  };
}

function createRichContext(): AiToolExecutionContext {
  return {
    ...createContext(),
    activeNamespace: "public",
    activeTab: {
      id: "tab-1",
      type: "query",
      title: "Query #1",
      sql: "SELECT * FROM public.users WHERE active = true",
      connectionId: "connection-1",
      targetSchema: "public",
      schemaName: "public",
      tableName: "users",
      objectType: "table",
      selection: {
        tabId: "tab-1",
        tabTitle: "Query #1",
        text: "SELECT * FROM public.users",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 27,
        connectionId: "connection-1",
      },
    },
  };
}

describe("AI MCP adapter", () => {
  it("lists registry tools with safety annotations", async () => {
    const protocol = createMcpProtocolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const response = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    const tools = response && "result" in response
      ? (response.result as { tools: Array<{ name: string; annotations?: Record<string, unknown> }> }).tools
      : [];
    expect(tools.map((tool) => tool.name)).toEqual([
      "demo.read",
      "demo.write",
    ]);
    expect(tools.find((tool) => tool.name === "demo.read")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tools.find((tool) => tool.name === "demo.write")?.annotations).toMatchObject({
      readOnlyHint: false,
    });
  });

  it("requires explicit approval for write tools", async () => {
    const protocol = createMcpProtocolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const blocked = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "demo.write",
        arguments: { value: "blocked" },
      },
    });
    const approved = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "demo.write",
        arguments: { value: "ok" },
        _meta: { "oxide/approved": true },
      },
    });

    expect(blocked && "result" in blocked ? blocked.result : null).toMatchObject({
      isError: true,
    });
    expect(approved && "result" in approved ? approved.result : null).toMatchObject({
      content: [
        {
          type: "text",
          text: expect.stringContaining('"mode": "write"'),
        },
      ],
    });
  });

  it("passes active context metadata into MCP tool calls", async () => {
    const protocol = createMcpProtocolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const response = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "demo.read",
        arguments: { value: "ok" },
        _meta: {
          "oxide/context": {
            activeConnectionId: "mongodb-1",
            activeDriver: "mongodb",
            activeNamespace: "app",
          },
        },
      },
    });
    const result = response && "result" in response
      ? (response.result as { content: Array<{ text: string }> })
      : null;

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(JSON.parse(result?.content[0]?.text || "{}")).toMatchObject({
      mode: "read",
      context: {
        activeConnectionId: "mongodb-1",
        activeDriver: "mongodb",
        activeNamespace: "app",
      },
    });
  });

  it("exposes a policy-aware manifest for external agents", async () => {
    const protocol = createMcpProtocolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      manifestEnvironment: {
        host: "test-mcp",
        enabledToolFamilies: ["demo"],
        disabledToolFamilies: [
          {
            name: "query.read",
            toolCount: 1,
            requiredAdapters: ["runReadOnlyQuery"],
            missingAdapters: ["runReadOnlyQuery"],
          },
        ],
      },
    });

    const response = await protocol.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "oxide/tools/manifest",
    });
    const result = response && "result" in response
      ? (response.result as { content: Array<{ text: string }> })
      : null;
    const manifest = JSON.parse(result?.content[0]?.text || "{}");

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      toolCount: 2,
      permissions: {
        read: 1,
        write: 1,
      },
      capabilities: {
        metadata: 1,
        query: 1,
      },
      environment: {
        host: "test-mcp",
        enabledToolFamilies: ["demo"],
      },
    });
    expect(manifest.environment.disabledToolFamilies).toEqual([
      expect.objectContaining({
        name: "query.read",
        missingAdapters: ["runReadOnlyQuery"],
      }),
    ]);
    expect(manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "demo.write",
          policy: expect.objectContaining({
            allowed: false,
            requiresApproval: true,
          }),
        }),
      ])
    );
  });
});

describe("AI CLI adapter", () => {
  it("calls read tools and blocks write tools without --approve", async () => {
    const cli = createCliToolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const read = await cli.run([
      "tools",
      "call",
      "demo.read",
      "--json",
      '{"value":"ok"}',
    ]);
    const blocked = await cli.run([
      "tools",
      "call",
      "demo.write",
      "--json",
      '{"value":"blocked"}',
    ]);
    const approved = await cli.run([
      "tools",
      "call",
      "demo.write",
      "--approve",
      "--json",
      '{"value":"ok"}',
    ]);

    expect(read.exitCode).toBe(0);
    expect(JSON.parse(read.stdout)).toMatchObject({ mode: "read" });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain("requires explicit approval");
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({ mode: "write" });
  });

  it("passes MCP JSON-RPC requests through the CLI adapter", async () => {
    const cli = createCliToolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      readFile: async (path) => {
        if (path !== "tools-list.json") throw new Error(`unexpected path: ${path}`);
        return '{"jsonrpc":"2.0","id":2,"method":"tools/list"}';
      },
    });

    const initialize = await cli.run([
      "mcp",
      "request",
      "--json",
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
    ]);
    const toolsList = await cli.run([
      "mcp",
      "request",
      "--json-file",
      "tools-list.json",
    ]);

    expect(initialize.exitCode).toBe(0);
    expect(JSON.parse(initialize.stdout)).toMatchObject({
      id: 1,
      result: {
        serverInfo: {
          name: "oxide-studio",
        },
      },
    });
    expect(toolsList.exitCode).toBe(0);
    expect(JSON.parse(toolsList.stdout)).toMatchObject({
      id: 2,
      result: {
        tools: [
          expect.objectContaining({ name: "demo.read" }),
          expect.objectContaining({ name: "demo.write" }),
        ],
      },
    });
  });

  it("prints the same policy-aware manifest from the CLI", async () => {
    const cli = createCliToolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      manifestEnvironment: {
        host: "test-cli",
        enabledToolFamilies: ["demo"],
        disabledToolFamilies: [],
      },
    });

    const result = await cli.run(["tools", "manifest"]);
    const manifest = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      toolCount: 2,
      permissions: {
        read: 1,
        write: 1,
      },
      environment: {
        host: "test-cli",
        enabledToolFamilies: ["demo"],
      },
    });
    expect(manifest.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "demo.write",
          policy: expect.objectContaining({
            allowed: false,
            requiresApproval: true,
          }),
        }),
      ])
    );
  });

  it("prints a single policy-aware tool definition from the CLI", async () => {
    const cli = createCliToolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const result = await cli.run(["tools", "inspect", "demo.write"]);
    const missing = await cli.run(["tools", "inspect", "demo.missing"]);
    const tool = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(tool).toMatchObject({
      name: "demo.write",
      inputSchema: {
        type: "object",
      },
      permissions: ["write"],
      policy: {
        allowed: false,
        requiresApproval: true,
      },
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Unknown AI tool: demo.missing");
  });

  it("passes active context overrides into direct tool calls", async () => {
    const cli = createCliToolAdapter({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const result = await cli.run([
      "tools",
      "call",
      "demo.read",
      "--json",
      '{"value":"ok"}',
      "--active-connection-id",
      "redis-1",
      "--active-driver",
      "redis",
      "--active-namespace",
      "2",
    ]);
    const output = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(output).toMatchObject({
      mode: "read",
      context: {
        activeConnectionId: "redis-1",
        activeDriver: "redis",
        activeNamespace: "2",
      },
    });
  });

  it("passes active driver and namespace overrides into assistant planning", async () => {
    const cli = createCliToolAdapter({
      registry: createPlannerRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const result = await cli.run([
      "assistant",
      "plan",
      "--message",
      "read key session:1",
      "--active-driver",
      "redis",
      "--active-namespace",
      "2",
    ]);
    const turn = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(turn.context).toMatchObject({
      activeDriver: "redis",
      activeNamespace: "2",
    });
    expect(turn.suggestedPlan).toContainEqual(
      expect.objectContaining({
        toolName: "key.getValue",
        input: { key: "session:1" },
      })
    );
  });
});

describe("AI tool input validation", () => {
  it("allows optional null inputs but rejects null for required fields", async () => {
    const registry = createTestRegistry();

    await expect(
      registry.executeWithPolicy(
        "demo.read",
        { value: null },
        createContext(),
        DEFAULT_AI_TOOL_POLICY
      )
    ).resolves.toMatchObject({ input: { value: null }, mode: "read" });

    registry.register({
      name: "demo.required",
      description: "Read a required demo value.",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
        required: ["value"],
        additionalProperties: false,
      },
      permissions: ["read"],
      capabilities: ["metadata"],
      execute: async (input) => ({ input, mode: "required" }),
    });

    await expect(
      registry.executeWithPolicy(
        "demo.required",
        { value: null },
        createContext(),
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("$.value must be string");
  });

  it("rejects invalid tool inputs before execution", async () => {
    const registry = createTestRegistry();

    await expect(
      registry.executeWithPolicy(
        "demo.read",
        { value: 42 },
        createContext(),
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("Invalid input for AI tool demo.read: $.value must be string");

    await expect(
      registry.executeWithPolicy(
        "demo.read",
        { value: "ok", extra: true },
        createContext(),
        DEFAULT_AI_TOOL_POLICY
      )
    ).rejects.toThrow("Invalid input for AI tool demo.read: $.extra is not allowed");
  });

  it("reports invalid model-planned tool inputs as assistant tool errors", async () => {
    const runtime = createAssistantRuntime({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const results = await runtime.executeToolCalls([
      {
        id: "bad-read",
        toolName: "demo.read",
        input: { value: 42 },
      },
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        id: "bad-read",
        toolName: "demo.read",
        status: "error",
        error: expect.stringContaining("$.value must be string"),
      }),
    ]);
  });
});

describe("LangGraph planner bridge", () => {
  it("plugs a graph planner into the assistant runtime contract", async () => {
    const runtime = createAssistantRuntime({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      planner: createLangGraphAssistantPlanner({
        invoke: async () => ({
          intent: "metadata",
          steps: [
            {
              id: "graph-read",
              title: "Read through graph planner",
              toolName: "demo.read",
              input: { value: "planned" },
              requiresApproval: false,
            },
          ],
        }),
      }),
    });

    const turn = await runtime.prepareTurnAsync({ message: "inspect metadata" });

    expect(turn.planner).toMatchObject({
      mode: "graph",
      framework: "langgraph",
    });
    expect(turn.suggestedPlan).toEqual([
      expect.objectContaining({
        id: "graph-read",
        toolName: "demo.read",
      }),
    ]);
  });

  it("wires graph nodes into a shared planner state before returning steps", async () => {
    const graphInvoke = createAssistantPlannerGraph({
      nodes: [
        (state) => ({
          metadata: {
            selectedConnection: state.context.activeConnectionId,
            toolCount: state.availableTools.length,
          },
          notes: ["context inspected"],
        }),
        (state) => ({
          result: {
            intent: "metadata",
            steps: [
              {
                id: "graph-context-read",
                title: `Read metadata for ${state.metadata.selectedConnection}`,
                toolName: "demo.read",
                input: {
                  value: String(state.metadata.toolCount),
                },
                requiresApproval: false,
              },
            ],
            warnings: ["graph warning"],
          },
          notes: ["plan produced"],
        }),
      ],
    });
    const runtime = createAssistantRuntime({
      registry: createTestRegistry(),
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      planner: createLangGraphAssistantPlanner({
        id: "test-graph",
        invoke: graphInvoke,
      }),
    });

    const turn = await runtime.prepareTurnAsync({ message: "inspect metadata" });

    expect(turn.planner).toMatchObject({
      id: "test-graph",
      mode: "graph",
      framework: "langgraph",
    });
    expect(turn.suggestedPlan).toEqual([
      expect.objectContaining({
        id: "graph-context-read",
        title: "Read metadata for connection-1",
        input: { value: "2" },
      }),
    ]);
    expect(turn.warnings).toContain("graph warning");
    expect(turn.notes).toEqual(["context inspected", "plan produced"]);
  });
});

describe("model assistant planner", () => {
  it("bounds large model planner text context before invoking providers", async () => {
    const largeSql = `SELECT * FROM logs WHERE message = '${"x".repeat(9_000)}'`;
    const largeSelection = "y".repeat(9_000);
    const richContext = createRichContext();
    let captured: AssistantModelPlannerRequest | null = null;
    const runtime = createAssistantRuntime({
      registry: createTestRegistry(),
      createContext: () => ({
        ...richContext,
        activeTab: {
          ...richContext.activeTab!,
          sql: largeSql,
          selection: {
            ...richContext.activeTab!.selection!,
            text: largeSelection,
          },
        },
      }),
      policy: DEFAULT_AI_TOOL_POLICY,
      planner: createModelAssistantPlanner({
        fallback: false,
        invoke: async (request) => {
          captured = request;
          return { intent: "query", steps: [] };
        },
      }),
    });

    await runtime.prepareTurnAsync({
      message: "inspect selected query",
      selectedText: largeSelection,
    });

    expect(captured?.turn.selectedText).toContain("[truncated]");
    expect(captured?.turn.selectedText?.length).toBeLessThan(largeSelection.length);
    expect(captured?.context.activeTab?.sql).toContain("[truncated]");
    expect(captured?.context.activeTab?.sql?.length).toBeLessThan(largeSql.length);
    expect(captured?.context.activeTab?.selection?.text).toContain("[truncated]");
    expect(captured?.context.activeTab?.selection?.text.length).toBeLessThan(
      largeSelection.length
    );
  });

  it("passes active workspace context to the model planner", async () => {
    let captured: AssistantModelPlannerRequest | null = null;
    const runtime = createAssistantRuntime({
      registry: createTestRegistry(),
      createContext: createRichContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      planner: createModelAssistantPlanner({
        invoke: async (request) => {
          captured = request;
          return {
            intent: "metadata",
            steps: [
              {
                id: "model-read",
                title: "Read current table metadata",
                toolName: "demo.read",
                input: { value: "users" },
              },
            ],
          };
        },
      }),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "describe the current table",
    });

    expect(turn.planner).toMatchObject({ mode: "model" });
    expect(captured?.context).toMatchObject({
      requestId: "test-request",
      activeConnectionId: "connection-1",
      activeDriver: "postgres",
      activeNamespace: "public",
      activeTab: {
        id: "tab-1",
        tableName: "users",
        selection: {
          text: "SELECT * FROM public.users",
        },
      },
    });
    expect(turn.suggestedPlan).toEqual([
      expect.objectContaining({
        id: "model-read",
        toolName: "demo.read",
        requiresApproval: false,
      }),
    ]);
  });

  it("falls back to the deterministic planner when the model provider fails", async () => {
    const registry = createAiToolRegistry();
    registry.register({
      name: "connection.list",
      description: "List connections.",
      inputSchema: { type: "object", additionalProperties: false },
      permissions: ["read"],
      capabilities: ["connection"],
      execute: async () => [],
    });

    const runtime = createAssistantRuntime({
      registry,
      createContext,
      policy: DEFAULT_AI_TOOL_POLICY,
      planner: createModelAssistantPlanner({
        invoke: async () => {
          throw new Error("provider offline");
        },
      }),
    });

    const turn = await runtime.prepareTurnAsync({
      message: "show this workspace",
    });

    expect(turn.warnings).toContain(
      "Model planner failed; used fallback planner: provider offline"
    );
    expect(turn.suggestedPlan).toContainEqual(
      expect.objectContaining({
        id: "connections",
        toolName: "connection.list",
      })
    );
  });

  it("passes active workspace context to model result summaries", async () => {
    let captured: AssistantModelResultSummaryRequest | null = null;
    const runtime = createAssistantRuntime({
      registry: createTestRegistry(),
      createContext: createRichContext,
      summarizeToolResults: createModelToolResultSummarizer(async (request) => {
        captured = request;
        return { message: "summarized with workspace context" };
      }),
    });

    const summary = await runtime.summarizeToolResults(
      { message: "summarize this" },
      [
        {
          id: "read",
          toolName: "demo.read",
          status: "success",
          output: { ok: true },
        },
      ]
    );

    expect(summary.message).toBe("summarized with workspace context");
    expect(captured?.context).toMatchObject({
      activeNamespace: "public",
      activeTab: {
        id: "tab-1",
        tableName: "users",
      },
    });
  });
});
