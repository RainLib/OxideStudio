import { createCliToolAdapter } from "@/ai/cli/adapter";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { describe, expect, it } from "vitest";
import {
  createContext,
  createPlannerRegistry,
  createTestRegistry,
} from "./fixtures";

export function registerCliAdapterTests() {
  describe("AI CLI adapter", () => {
    it("calls read tools and rejects self-approved writes", async () => {
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
      expect(approved.exitCode).toBe(1);
      expect(approved.stderr).toContain("not a valid authorization");
    });

    it("passes MCP JSON-RPC requests through the CLI adapter", async () => {
      const cli = createCliToolAdapter({
        registry: createTestRegistry(),
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
        readFile: async (path) => {
          if (path !== "tools-list.json")
            throw new Error(`unexpected path: ${path}`);
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
        ]),
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
        }),
      );
    });

    it("loads selected text from a file for assistant planning", async () => {
      const cli = createCliToolAdapter({
        registry: createPlannerRegistry(),
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
        readFile: async (path) => {
          if (path !== "selection.sql") {
            throw new Error(`unexpected path: ${path}`);
          }
          return "SELECT * FROM users";
        },
      });

      const result = await cli.run([
        "assistant",
        "plan",
        "--message",
        "run selected query",
        "--selected-text-file",
        "selection.sql",
      ]);
      const turn = JSON.parse(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(turn.suggestedPlan).toContainEqual(
        expect.objectContaining({
          toolName: "query.runReadOnly",
          input: { query: "SELECT * FROM users" },
        }),
      );
    });
  });
}
