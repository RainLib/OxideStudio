import { describe, expect, it } from "vitest";
import {
  boundedAssistantText,
  boundedConversationHistory,
  CHAT_CONTEXT_LIMITS,
} from "@/ai/assistant/chatContext";

describe("assistant chat context", () => {
  it("bounds individual context values without exceeding the limit", () => {
    const result = boundedAssistantText("x".repeat(100), 40);
    expect(result).toHaveLength(40);
    expect(result?.endsWith("...[truncated]")).toBe(true);
  });

  it("keeps the most recent history within message and total limits", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:`.padEnd(10_000, "x"),
    }));

    const result = boundedConversationHistory(history);
    const totalCharacters = result.reduce(
      (total, entry) => total + entry.content.length,
      0
    );

    expect(result.length).toBeLessThanOrEqual(
      CHAT_CONTEXT_LIMITS.historyMessages
    );
    expect(totalCharacters).toBeLessThanOrEqual(
      CHAT_CONTEXT_LIMITS.historyCharacters
    );
    expect(result.at(-1)?.content.startsWith("19:")).toBe(true);
    expect(result.every((entry) => entry.content.length <= 6_000)).toBe(true);
  });
});
