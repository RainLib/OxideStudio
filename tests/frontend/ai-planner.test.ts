import { describe, expect, it } from "vitest";
import { createDefaultAssistantPlanner } from "@/ai/assistant/planner";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import type { AiToolSummary } from "@/ai/tools/types";

const QUERY_TOOLS: AiToolSummary[] = [
  {
    name: "query.runReadOnly",
    description: "Run read-only query.",
    inputSchema: { type: "object" },
    permissions: ["read"],
    capabilities: ["query"],
  },
  {
    name: "key.getValue",
    description: "Read Redis key.",
    inputSchema: { type: "object" },
    permissions: ["read"],
    capabilities: ["query"],
  },
  {
    name: "key.deleteKeys",
    description: "Delete Redis keys.",
    inputSchema: { type: "object" },
    permissions: ["destructive"],
    capabilities: ["query"],
  },
];

describe("default assistant planner", () => {
  it("plans Redis key reads without requiring selected text", () => {
    const result = createDefaultAssistantPlanner().plan({
      turn: { message: "read key session:1" },
      context: {
        requestId: "planner-key-read",
        activeDriver: "redis",
      },
      availableTools: QUERY_TOOLS,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    expect(result.intent).toBe("query");
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        id: "query-execution",
        toolName: "key.getValue",
        input: { key: "session:1" },
        requiresApproval: false,
      })
    );
  });
});
