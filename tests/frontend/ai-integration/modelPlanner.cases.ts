import {
  createModelAssistantPlanner,
  createModelToolResultSummarizer,
  type AssistantModelPlannerRequest,
  type AssistantModelResultSummaryRequest,
} from "@/ai/assistant/modelPlanner";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { createAiToolRegistry } from "@/ai/tools/registry";
import { describe, expect, it } from "vitest";
import {
  createContext,
  createRichContext,
  createTestRegistry,
} from "./fixtures";

export function registerModelPlannerTests() {
  describe("model assistant planner", () => {
    it("bounds large model planner text context before invoking providers", async () => {
      const largeSql = `SELECT * FROM logs WHERE message = '${"x".repeat(9_000)}'`;
      const largeSelection = "y".repeat(9_000);
      const largePrompt = "z".repeat(20_000);
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
        message: largePrompt,
        selectedText: largeSelection,
        history: Array.from({ length: 14 }, (_, index) => ({
          role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
          content: index >= 5 ? largeSelection : `message ${index}`,
        })),
      });

      expect(captured?.turn.message).toContain("[truncated]");
      expect(captured?.turn.message.length).toBeLessThan(largePrompt.length);
      expect(captured?.turn.selectedText).toContain("[truncated]");
      expect(captured?.turn.selectedText?.length).toBeLessThan(
        largeSelection.length,
      );
      expect(captured?.turn.history?.length).toBeLessThanOrEqual(12);
      expect(
        captured?.turn.history?.reduce(
          (total, message) => total + message.content.length,
          0,
        ),
      ).toBeLessThanOrEqual(24_000);
      expect(captured?.turn.history?.at(-1)?.content).toContain("[truncated]");
      expect(captured?.context.activeTab?.sql).toContain("[truncated]");
      expect(captured?.context.activeTab?.sql?.length).toBeLessThan(
        largeSql.length,
      );
      expect(captured?.context.activeTab?.selection?.text).toContain(
        "[truncated]",
      );
      expect(captured?.context.activeTab?.selection?.text.length).toBeLessThan(
        largeSelection.length,
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
        "Model planner failed; used fallback planner: provider offline",
      );
      expect(turn.suggestedPlan).toContainEqual(
        expect.objectContaining({
          id: "connections",
          toolName: "connection.list",
        }),
      );
    });

    it("passes active workspace context to model result summaries", async () => {
      let captured: AssistantModelResultSummaryRequest | null = null;
      const runtime = createAssistantRuntime({
        registry: createTestRegistry(),
        createContext: createRichContext,
        summarizeToolResults: createModelToolResultSummarizer(
          async (request) => {
            captured = request;
            return { message: "summarized with workspace context" };
          },
        ),
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
        ],
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

    it("falls back to a local result summary when the model summary fails", async () => {
      const runtime = createAssistantRuntime({
        registry: createTestRegistry(),
        createContext,
        summarizeToolResults: async () => {
          throw new Error("provider offline");
        },
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
        ],
      );

      expect(summary.message).toBe(
        "1 tool call succeeded. Detailed model summary unavailable.",
      );
      expect(summary.warnings).toContain(
        "Model result summary failed; used the local summary.",
      );
    });

    it("normalizes model-suggested follow-up calls through the runtime policy", () => {
      const runtime = createAssistantRuntime({
        registry: createTestRegistry(),
        createContext,
      });

      const followUps = runtime.normalizeSuggestedCalls(
        [
          {
            id: "read",
            toolName: "demo.read",
            input: { value: "next" },
            reason: "Inspect the next value",
            approved: true,
          },
          {
            id: "write",
            toolName: "demo.write",
            input: { value: "change" },
            approved: true,
          },
          {
            id: "unknown",
            toolName: "demo.missing",
            input: "invalid",
          },
        ],
        ["read"],
      );

      expect(followUps.steps).toEqual([
        expect.objectContaining({
          id: "read-2",
          title: "Inspect the next value",
          toolName: "demo.read",
          requiresApproval: false,
        }),
        expect.objectContaining({
          id: "write",
          toolName: "demo.write",
          requiresApproval: true,
        }),
      ]);
      expect(followUps.warnings).toContain(
        "Assistant planner requested unknown tool: demo.missing",
      );
      expect(followUps.warnings).toContain(
        "Assistant follow-up demo.missing had a non-object input and was normalized.",
      );
    });
  });
}
