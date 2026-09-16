import { createAssistantRuntime } from "@/ai/assistant/runtime";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import type {
  AiToolAuditEntry,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import { describe, expect, it } from "vitest";
import { createContext, createTestRegistry } from "./fixtures";

export function registerInputValidationTests() {
  describe("AI tool input validation", () => {
    it("allows optional null inputs but rejects null for required fields", async () => {
      const registry = createTestRegistry();

      await expect(
        registry.executeWithPolicy(
          "demo.read",
          { value: null },
          createContext(),
          DEFAULT_AI_TOOL_POLICY,
        ),
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
          DEFAULT_AI_TOOL_POLICY,
        ),
      ).rejects.toThrow("$.value must be string");
    });

    it("rejects invalid tool inputs before execution", async () => {
      const registry = createTestRegistry();

      await expect(
        registry.executeWithPolicy(
          "demo.read",
          { value: 42 },
          createContext(),
          DEFAULT_AI_TOOL_POLICY,
        ),
      ).rejects.toThrow(
        "Invalid input for AI tool demo.read: $.value must be string",
      );

      await expect(
        registry.executeWithPolicy(
          "demo.read",
          { value: "ok", extra: true },
          createContext(),
          DEFAULT_AI_TOOL_POLICY,
        ),
      ).rejects.toThrow(
        "Invalid input for AI tool demo.read: $.extra is not allowed",
      );
    });

    it("records bounded and redacted audit entries for tool execution", async () => {
      const registry = createTestRegistry();
      const auditEntries: AiToolAuditEntry[] = [];
      const context: AiToolExecutionContext = {
        ...createContext(),
        audit: (entry) => auditEntries.push(entry),
      };

      registry.register({
        name: "demo.error",
        description: "Raise an error that includes sensitive operational text.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
        },
        permissions: ["read"],
        capabilities: ["query"],
        execute: async () => {
          throw new Error(
            [
              "query: SELECT * FROM private.users WHERE token = 'secret-token';",
              "postgres://admin:super-secret@localhost/app?password=hidden",
              "x".repeat(600),
            ].join(" "),
          );
        },
      });

      await registry.executeWithPolicy(
        "demo.read",
        { value: "ok" },
        context,
        DEFAULT_AI_TOOL_POLICY,
      );
      await expect(
        registry.executeWithPolicy(
          "demo.write",
          { value: "blocked" },
          context,
          DEFAULT_AI_TOOL_POLICY,
        ),
      ).rejects.toThrow("requires explicit approval");
      await expect(
        registry.executeWithPolicy(
          "demo.error",
          {},
          context,
          DEFAULT_AI_TOOL_POLICY,
        ),
      ).rejects.toThrow("SELECT * FROM private.users");

      expect(auditEntries.map((entry) => entry.status)).toEqual([
        "success",
        "blocked",
        "error",
      ]);
      const errorReason = auditEntries.find(
        (entry) => entry.toolName === "demo.error",
      )?.reason;
      expect(errorReason).toContain("query: <redacted>");
      expect(errorReason).toContain(
        "postgres://admin:****@localhost/app?password=****",
      );
      expect(errorReason).not.toContain("SELECT * FROM private.users");
      expect(errorReason).not.toContain("super-secret");
      expect(errorReason).not.toContain("hidden");
      expect(errorReason?.length).toBeLessThanOrEqual(503);
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

    it("audits assistant policy blocks before returning approval status", async () => {
      const registry = createTestRegistry();
      const auditEntries: AiToolAuditEntry[] = [];
      const runtime = createAssistantRuntime({
        registry,
        createContext: () => ({
          ...createContext(),
          audit: (entry) => auditEntries.push(entry),
        }),
        policy: DEFAULT_AI_TOOL_POLICY,
      });

      const context = {
        ...createContext(),
        audit: (entry: AiToolAuditEntry) => auditEntries.push(entry),
      };
      const results = await runtime.executeToolCalls(
        [
          {
            id: "blocked-write",
            toolName: "demo.write",
            input: { value: "blocked" },
          },
        ],
        context,
      );

      expect(results).toEqual([
        expect.objectContaining({
          id: "blocked-write",
          status: "requiresApproval",
        }),
      ]);
      expect(auditEntries).toEqual([
        expect.objectContaining({
          toolName: "demo.write",
          permissions: ["write"],
          status: "blocked",
        }),
      ]);
    });
  });
}
