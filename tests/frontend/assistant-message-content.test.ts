import { describe, expect, it } from "vitest";
import { parseAssistantMessage } from "@/components/workspace/assistant/AssistantMessageContent";

describe("assistant message content", () => {
  it("separates fenced SQL from surrounding explanation", () => {
    expect(
      parseAssistantMessage(
        "Use a bounded query:\n```sql\nSELECT * FROM users LIMIT 10;\n```\nReview before running."
      )
    ).toEqual([
      { type: "text", content: "Use a bounded query:" },
      {
        type: "code",
        language: "sql",
        content: "SELECT * FROM users LIMIT 10;",
      },
      { type: "text", content: "Review before running." },
    ]);
  });

  it("renders an unterminated fence as code without interpreting HTML", () => {
    expect(parseAssistantMessage("```json\n<script>alert(1)</script>")).toEqual([
      {
        type: "code",
        language: "json",
        content: "<script>alert(1)</script>",
      },
    ]);
  });
});
