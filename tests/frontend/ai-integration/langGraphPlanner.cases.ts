import {
  createAssistantPlannerGraph,
  createLangGraphAssistantPlanner,
  createOfficialLangGraphAssistantPlanner,
} from "@/ai/assistant/langGraphPlanner";
import { createAssistantPlannerSelection } from "@/ai/assistant/plannerRegistry";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { describe, expect, it } from "vitest";
import { createContext, createTestRegistry } from "./fixtures";

export function registerLangGraphPlannerTests() {
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

      const turn = await runtime.prepareTurnAsync({
        message: "inspect metadata",
      });

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

      const turn = await runtime.prepareTurnAsync({
        message: "inspect metadata",
      });

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

    it("uses the official LangGraph planner adapter and enforces tool policy", async () => {
      const runtime = createAssistantRuntime({
        registry: createTestRegistry(),
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
        planner: createOfficialLangGraphAssistantPlanner({
          primaryPlanner: createLangGraphAssistantPlanner({
            id: "unsafe-primary",
            invoke: async () => ({
              intent: "query",
              steps: [
                {
                  id: "write-step",
                  title: "Write through graph",
                  toolName: "demo.write",
                  input: { value: "planned" },
                  requiresApproval: false,
                },
              ],
            }),
          }),
        }),
      });

      const turn = await runtime.prepareTurnAsync({ message: "update demo" });

      expect(turn.planner).toMatchObject({
        id: "official-langgraph-tool-planner",
        mode: "graph",
        framework: "langgraph",
      });
      expect(turn.suggestedPlan).toEqual([
        expect.objectContaining({
          id: "write-step",
          toolName: "demo.write",
          requiresApproval: true,
        }),
      ]);
    });

    it("selects the LangGraph plugin planner from AI settings", async () => {
      const selection = createAssistantPlannerSelection({
        enabled: true,
        plannerKind: "langgraph",
        modelConfig: null,
      });
      const runtime = createAssistantRuntime({
        registry: createTestRegistry(),
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
        planner: selection.planner,
      });

      const turn = await runtime.prepareTurnAsync({
        message: "inspect metadata",
      });

      expect(selection.label).toBe("LangGraph planner (local fallback)");
      expect(turn.planner).toMatchObject({
        mode: "graph",
        framework: "langgraph",
      });
      expect(turn.notes).toContain(
        "Planner node completed with default-rule-planner.",
      );
    });
  });
}
