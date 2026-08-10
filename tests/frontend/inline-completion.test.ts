import { describe, expect, it } from "vitest";
import {
  boundedInlineContext,
  cleanInlineSuggestion,
  InlineCompletionCache,
  localInlineSuggestion,
  mergeInlineCompletionCandidates,
  shouldRequestAiInlineCompletion,
} from "@/lib/inlineCompletion";

describe("inline completion helpers", () => {
  it("bounds prefix and suffix around the cursor", () => {
    const value = `${"a".repeat(9_000)}CURSOR${"b".repeat(5_000)}`;
    const context = boundedInlineContext(value, 9_006);
    expect(context.prefix).toHaveLength(8_192);
    expect(context.prefix.endsWith("CURSOR")).toBe(true);
    expect(context.suffix).toHaveLength(4_096);
  });

  it("turns the best LSP candidate into ghost-text remainder", () => {
    expect(
      localInlineSuggestion("SELECT * FR", {
        candidates: [
          { label: "FROM", insertText: "FROM" },
          { label: "WHERE", insertText: "WHERE" },
        ],
      })
    ).toBe("OM");
  });

  it("uses shared qualified edits and code-block snippets as local ghost text", () => {
    expect(
      localInlineSuggestion("SELECT * FROM users u WHERE u.", {
        candidates: [{ label: "email", insertText: "email" }],
      })
    ).toBe("email");
    expect(
      localInlineSuggestion("ins", {
        candidates: [
          {
            label: "insert users",
            insertText:
              "INSERT INTO users (\n  email\n)\nVALUES (\n  ${1:email_value}\n);",
          },
        ],
      })
    ).toBe("ERT INTO users (\n  email\n)\nVALUES (\n  email_value\n);");
    expect(
      localInlineSuggestion("SELECT * FROM", {
        candidates: [{ label: "users", insertText: " users" }],
      })
    ).toBe(" users");
  });

  it("merges exact command blocks ahead of LSP candidates with bounded usage ranking", () => {
    const context = mergeInlineCompletionCandidates(
      {
        candidates: [
          { label: "SELECT", insertText: "SELECT", kind: 14 },
          { label: "source_table", insertText: "source_table", kind: 6 },
        ],
      },
      [
        {
          label: "select rows",
          insertText: "SELECT ${1:*}\nFROM ${2:table};",
          kind: 15,
          preferred: true,
        },
        { label: "show tables", insertText: "SHOW TABLES;", kind: 15 },
      ],
      {
        maxCandidates: 3,
        rankByUsage: true,
        usageScore: (label) => (label === "source_table" ? 50 : 0),
      },
    );

    expect(context.candidates?.map((candidate) => candidate.label)).toEqual([
      "select rows",
      "source_table",
      "SELECT",
    ]);
    expect(localInlineSuggestion("sel", context)).toBe(
      "ECT *\nFROM table;",
    );
  });

  it("deduplicates shared insertions before enforcing the inline candidate cap", () => {
    const context = mergeInlineCompletionCandidates(
      { candidates: [{ label: "SELECT", insertText: "SELECT" }] },
      [
        { label: "select duplicate", insertText: "select" },
        { label: "transaction", insertText: "START TRANSACTION;" },
      ],
      { maxCandidates: 2 },
    );

    expect(context.candidates).toEqual([
      { label: "SELECT", insertText: "SELECT" },
      { label: "transaction", insertText: "START TRANSACTION;" },
    ]);
  });

  it("cleans fences, repeated prefix, suffix overlap, and line overflow", () => {
    expect(
      cleanInlineSuggestion(
        "```sql\nSELECT * FROM users WHERE id = 1;\n```",
        "SELECT * FROM users ",
        ";\n"
      )
    ).toBe("WHERE id = 1");
    const manyLines = Array.from({ length: 20 }, (_, index) => `${index}`).join(
      "\n"
    );
    expect(cleanInlineSuggestion(manyLines, "", "").split("\n")).toHaveLength(
      12
    );
  });

  it("suppresses automatic requests for selections and string literals", () => {
    expect(
      shouldRequestAiInlineCompletion({
        prefix: "SELECT ",
        hasSelection: true,
        automatic: true,
        explicit: false,
      })
    ).toBe(false);
    expect(
      shouldRequestAiInlineCompletion({
        prefix: "SELECT 'secret",
        hasSelection: false,
        automatic: true,
        explicit: false,
      })
    ).toBe(false);
    expect(
      shouldRequestAiInlineCompletion({
        prefix: "SELECT 'secret",
        hasSelection: false,
        automatic: true,
        explicit: true,
      })
    ).toBe(true);
  });

  it("evicts least recently used and expired suggestions", () => {
    const cache = new InlineCompletionCache(2, 10);
    cache.set("a", "A", 0);
    cache.set("b", "B", 0);
    expect(cache.get("a", 1)).toBe("A");
    cache.set("c", "C", 1);
    expect(cache.get("b", 1)).toBeUndefined();
    expect(cache.get("a", 11)).toBeUndefined();
  });
});
