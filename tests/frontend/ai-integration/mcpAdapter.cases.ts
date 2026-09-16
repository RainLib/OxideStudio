import { createMcpProtocolAdapter } from "@/ai/mcp/protocol";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { createAiToolRegistry } from "@/ai/tools/registry";
import { describe, expect, it } from "vitest";
import { createContext, createTestRegistry } from "./fixtures";

export function registerMcpAdapterTests() {
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
      const tools =
        response && "result" in response
          ? (
              response.result as {
                tools: Array<{
                  name: string;
                  annotations?: Record<string, unknown>;
                }>;
              }
            ).tools
          : [];
      expect(tools.map((tool) => tool.name)).toEqual([
        "demo.read",
        "demo.write",
      ]);
      expect(
        tools.find((tool) => tool.name === "demo.read")?.annotations,
      ).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(
        tools.find((tool) => tool.name === "demo.write")?.annotations,
      ).toMatchObject({
        readOnlyHint: false,
      });
    });

    it("rejects caller-provided approval metadata for write tools", async () => {
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

      expect(
        blocked && "result" in blocked ? blocked.result : null,
      ).toMatchObject({
        isError: true,
      });
      expect(
        approved && "result" in approved ? approved.result : null,
      ).toMatchObject({
        isError: true,
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
      const result =
        response && "result" in response
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
      const result =
        response && "result" in response
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
        ]),
      );
    });

    it("inspects a single policy-aware tool definition for external agents", async () => {
      const protocol = createMcpProtocolAdapter({
        registry: createTestRegistry(),
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
      });

      const response = await protocol.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "oxide/tools/inspect",
        params: {
          name: "demo.write",
        },
      });
      const invalid = await protocol.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/inspect",
        params: {},
      });
      const result =
        response && "result" in response
          ? (response.result as { content: Array<{ text: string }> })
          : null;
      const tool = JSON.parse(result?.content[0]?.text || "{}");

      expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 });
      expect(tool).toMatchObject({
        name: "demo.write",
        permissions: ["write"],
        policy: {
          allowed: false,
          requiresApproval: true,
        },
      });
      expect(invalid).toMatchObject({
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32602,
          message: "tools/inspect requires params.name",
        },
      });
    });

    it("aborts in-flight MCP tool calls on cancelled notifications", async () => {
      const registry = createAiToolRegistry();
      let finishToolCall: (() => void) | undefined;
      const started = new Promise<AbortSignal | undefined>((resolveStarted) => {
        registry.register({
          name: "demo.slow",
          description: "Run a slow demo read.",
          inputSchema: { type: "object", additionalProperties: false },
          permissions: ["read"],
          capabilities: ["query"],
          execute: async (_input, context) => {
            resolveStarted(context.abortSignal);
            await new Promise<void>((resolve) => {
              finishToolCall = resolve;
            });
            return { aborted: context.abortSignal?.aborted ?? false };
          },
        });
      });
      const protocol = createMcpProtocolAdapter({
        registry,
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
      });

      const call = protocol.handleMessage({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: {
          name: "demo.slow",
          arguments: {},
        },
      });
      const signal = await started;

      expect(signal).toBeTruthy();
      expect(signal?.aborted).toBe(false);
      expect(
        await protocol.handleMessage({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: {
            requestId: 99,
            reason: "user stopped the request",
          },
        }),
      ).toBeNull();
      expect(signal?.aborted).toBe(true);

      finishToolCall?.();
      await expect(call).resolves.toBeNull();
    });
  });
}
