import { createAssistantRuntime } from "@/ai/assistant/runtime";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { describe, expect, it } from "vitest";
import { createContext, createTestRegistry } from "./fixtures";

export function registerPlanNormalizationTests() {
  describe("assistant runtime plan normalization", () => {
    it("recomputes approval policy and assigns unique step ids", async () => {
      const runtime = createAssistantRuntime({
        registry: createTestRegistry(),
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
        planner: {
          id: "untrusted-test-planner",
          mode: "model",
          description: "Returns deliberately unsafe plan metadata.",
          plan: () => ({
            intent: "query",
            steps: [
              {
                id: "duplicate",
                title: "Read",
                toolName: "demo.read",
                input: { value: "one" },
                requiresApproval: true,
              },
              {
                id: "duplicate",
                title: "Write",
                toolName: "demo.write",
                input: { value: "two" },
                requiresApproval: false,
              },
              {
                id: "unknown",
                title: "Unknown",
                toolName: "demo.missing",
                requiresApproval: false,
              },
            ],
          }),
        },
      });

      const turn = await runtime.prepareTurnAsync({ message: "change demo" });

      expect(turn.suggestedPlan).toEqual([
        expect.objectContaining({
          id: "duplicate",
          toolName: "demo.read",
          requiresApproval: false,
        }),
        expect.objectContaining({
          id: "duplicate-2",
          toolName: "demo.write",
          requiresApproval: true,
        }),
      ]);
      expect(turn.warnings).toContain(
        "Assistant planner requested unknown tool: demo.missing",
      );
    });
  });
}
