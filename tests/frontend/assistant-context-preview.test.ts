import { describe, expect, it, vi } from "vitest";
import {
  applyAssistantContextSettings,
  createAssistantContextPreview,
  createAssistantTurnInput,
  DEFAULT_ASSISTANT_CONTEXT_SETTINGS,
} from "@/ai/assistant/contextPreview";
import {
  createModelAssistantPlanner,
  MODEL_CONTEXT_TEXT_LIMIT,
  MODEL_RESULT_COUNT_LIMIT,
  MODEL_RESULT_TOTAL_LIMIT,
} from "@/ai/assistant/modelPlanner";
import { CHAT_CONTEXT_LIMITS } from "@/ai/assistant/chatContext";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";

const context = {
  requestId: "preview",
  activeConnectionId: "connection-safe-id",
  activeDriver: "postgres" as const,
  activeNamespace: "analytics",
  activeTab: {
    id: "tab-1",
    type: "query",
    title: "Revenue query",
    databaseName: "warehouse",
    sql: "S".repeat(MODEL_CONTEXT_TEXT_LIMIT + 500),
    selection: {
      tabId: "tab-1",
      tabTitle: "Revenue query",
      text: "X".repeat(MODEL_CONTEXT_TEXT_LIMIT + 500),
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 10,
    },
  },
};

describe("assistant context preview", () => {
  it("reports the exact bounded provider payload and post-tool phase", () => {
    const history = Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:${"H".repeat(3_000)}`,
    }));

    const preview = createAssistantContextPreview({
      message: "inspect the selected data",
      mode: "agent",
      providerLabel: "gpt-test",
      context,
      selectedText: context.activeTab.selection.text,
      history,
      settings: DEFAULT_ASSISTANT_CONTEXT_SETTINGS,
    });

    expect(preview).toMatchObject({
      resolvedMode: "agent",
      destination: "provider",
      destinationLabel: "gpt-test",
      databaseIdentity:
        "postgres · connection-safe-id · warehouse · analytics",
      sendsToolManifest: true,
      canShareToolResults: true,
      sendsToolResults: true,
    });
    expect(preview.editor).toMatchObject({
      included: true,
      sentCharacters: MODEL_CONTEXT_TEXT_LIMIT,
      truncated: true,
    });
    expect(preview.selection.sentCharacters).toBe(MODEL_CONTEXT_TEXT_LIMIT);
    expect(preview.history.sentMessages).toBeLessThanOrEqual(
      CHAT_CONTEXT_LIMITS.historyMessages,
    );
    expect(preview.history.sentCharacters).toBeLessThanOrEqual(
      CHAT_CONTEXT_LIMITS.historyCharacters,
    );
    expect(preview.history.truncated).toBe(true);
    expect(preview.toolResultDetail).toContain(String(MODEL_RESULT_COUNT_LIMIT));
    expect(preview.toolResultDetail).toContain(
      MODEL_RESULT_TOTAL_LIMIT.toLocaleString(),
    );
  });

  it("strips excluded editor, selection and history data from the real inputs", () => {
    const settings = {
      includeEditorContent: false,
      includeSelection: false,
      includeHistory: false,
      shareToolResults: false,
    };
    const scopedContext = applyAssistantContextSettings(context, settings);
    const turn = createAssistantTurnInput(
      "explain",
      "agent",
      "private selection",
      [{ role: "user", content: "private history" }],
      settings,
    );
    const serialized = JSON.stringify({ scopedContext, turn });

    expect(scopedContext.activeTab?.sql).toBeUndefined();
    expect(scopedContext.activeTab?.selection).toBeNull();
    expect(turn.selectedText).toBeNull();
    expect(turn.history).toEqual([]);
    expect(serialized).not.toContain("private selection");
    expect(serialized).not.toContain("private history");
  });

  it("keeps excluded content out of the model planner request", async () => {
    const settings = {
      includeEditorContent: false,
      includeSelection: false,
      includeHistory: false,
      shareToolResults: false,
    };
    const scopedContext = applyAssistantContextSettings(context, settings);
    const turn = createAssistantTurnInput(
      "inspect metadata",
      "plan",
      "private planner selection",
      [{ role: "user", content: "private planner history" }],
      settings,
    );
    const invoke = vi.fn(async () => ({
      intent: "metadata" as const,
      steps: [],
    }));
    const planner = createModelAssistantPlanner({
      invoke,
      fallback: false,
    });

    await planner.plan({
      turn,
      context: scopedContext,
      availableTools: [],
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    const request = invoke.mock.calls[0]?.[0];
    const serialized = JSON.stringify(request);
    expect(serialized).not.toContain(context.activeTab.sql);
    expect(serialized).not.toContain("private planner selection");
    expect(serialized).not.toContain("private planner history");
    expect(request?.context.activeTab?.sql).toBeUndefined();
    expect(request?.context.activeTab?.selection).toBeNull();
  });

  it("distinguishes local planning from an unavailable Chat provider", () => {
    const local = createAssistantContextPreview({
      message: "inspect metadata",
      mode: "agent",
      providerLabel: null,
      context,
      selectedText: null,
      history: [],
      settings: DEFAULT_ASSISTANT_CONTEXT_SETTINGS,
    });
    const unavailable = createAssistantContextPreview({
      message: "hello",
      mode: "chat",
      providerLabel: null,
      context,
      selectedText: null,
      history: [],
      settings: DEFAULT_ASSISTANT_CONTEXT_SETTINGS,
    });

    expect(local.destination).toBe("local");
    expect(local.sendsToolResults).toBe(false);
    expect(local.toolResultDetail).toContain("stay local");
    expect(local.canShareToolResults).toBe(false);
    expect(unavailable.destination).toBe("unavailable");
    expect(unavailable.destinationLabel).toContain("nothing will be sent");
  });
});
