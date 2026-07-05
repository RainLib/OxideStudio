import { describe, expect, it } from "vitest";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import { createLangGraphAssistantPlanner } from "@/ai/assistant/langGraphPlanner";
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
    execute: async (input) => ({ input, mode: "read" }),
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

function createContext(): AiToolExecutionContext {
  return {
    requestId: "test-request",
    activeConnectionId: "connection-1",
    activeDriver: "postgres",
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
});
