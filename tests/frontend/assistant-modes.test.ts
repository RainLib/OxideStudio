import { describe, expect, it } from "vitest";
import { resolveAssistantMode } from "@/ai/assistant/modes";

describe("assistant modes", () => {
  it("preserves explicitly selected modes", () => {
    expect(resolveAssistantMode("chat", "run the query")).toBe("chat");
    expect(resolveAssistantMode("plan", "run the query")).toBe("plan");
    expect(resolveAssistantMode("agent", "just explain it")).toBe("agent");
  });

  it("routes O2 planning requests without executing tools", () => {
    expect(resolveAssistantMode("o2", "plan a safe schema migration")).toBe(
      "plan"
    );
    expect(resolveAssistantMode("o2", "规划数据库迁移步骤")).toBe("plan");
  });

  it("routes O2 tool requests to Agent in English and Chinese", () => {
    expect(resolveAssistantMode("o2", "inspect the current database")).toBe(
      "agent"
    );
    expect(resolveAssistantMode("o2", "执行当前查询")).toBe("agent");
    expect(resolveAssistantMode("o2", "查看当前表结构")).toBe("agent");
  });

  it("routes conversational O2 requests to Chat", () => {
    expect(resolveAssistantMode("o2", "what is a lateral join?")).toBe(
      "chat"
    );
  });
});
