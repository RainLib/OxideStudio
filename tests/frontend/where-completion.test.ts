import { describe, expect, it } from "vitest";
import {
  buildWhereCompletionDocument,
  localWhereCompletionCandidates,
  mergeWhereCompletionCandidates,
  whereReplacementRange,
  type WhereCompletionCandidate,
} from "@/lib/whereCompletion";
import { CompletionItemKind } from "@/services/lsp/types";

describe("table WHERE completion", () => {
  it.each([
    ["postgres", 'SELECT * FROM "public"."users" WHERE status = 1;'],
    ["mysql", "SELECT * FROM `app`.`users` WHERE status = 1;"],
  ] as const)("builds a dialect-aware virtual %s document", (driver, text) => {
    const document = buildWhereCompletionDocument({
      condition: "status = 1",
      cursorOffset: 6,
      driver,
      schema: driver === "postgres" ? "public" : "app",
      table: "users",
    });
    expect(document.text).toBe(text);
    expect(document.text.slice(document.conditionStart)).toBe("status = 1;");
    expect(document.character).toBe(document.conditionStart + 6);
  });

  it.each([
    ['"status code"', "postgres"],
    ["`status code`", "mysql"],
    ["[status code]", "sqlserver"],
    ['public."status code"', "postgres"],
  ])(
    "continues a quoted or qualified %s field with predicate operators",
    (reference, driver) => {
      const candidates = localWhereCompletionCandidates({
        condition: `${reference} `,
        cursorOffset: reference.length + 1,
        driver,
        columns: [{ name: "status code", type: "text" }],
      });

      expect(candidates.map((candidate) => candidate.label)).toEqual(
        expect.arrayContaining(["=", "IN", "BETWEEN", "IS NULL"]),
      );
      expect(candidates.map((candidate) => candidate.label)).not.toContain(
        "status code",
      );
    },
  );

  it("replaces the full identifier under the caret", () => {
    expect(whereReplacementRange("status = 1", 3)).toEqual({
      start: 0,
      end: 6,
    });
    expect(whereReplacementRange("user.email = 1", 7)).toEqual({
      start: 0,
      end: 10,
    });
    expect(whereReplacementRange('"status code" = 1', 7)).toEqual({
      start: 0,
      end: 13,
    });
    expect(whereReplacementRange('"sta', 4)).toEqual({ start: 0, end: 4 });
  });

  it("supports prefix, middle, and abbreviation matching like an IDE popup", () => {
    const columns = [
      { name: "created_at", type: "timestamp" },
      { name: "customerAccountId", type: "uuid" },
      { name: "status", type: "text" },
    ];
    const labels = (condition: string) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns,
      }).map((item) => item.label);

    expect(labels("sta")[0]).toBe("status");
    expect(labels("count")).toContain("customerAccountId");
    expect(labels("cai")).toContain("customerAccountId");
  });

  it("switches from columns to values and boolean continuations by predicate phase", () => {
    const complete = (condition: string) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns: [{ name: "status", type: "text" }],
      }).map((item) => item.label);

    expect(complete("status = ")).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    expect(complete("status = ")).not.toContain("status");
    expect(complete("status = 'active' ")).toEqual(
      expect.arrayContaining(["AND", "OR"]),
    );
    expect(complete("status = 'active' ")).not.toContain("status");
    expect(complete("status ")).toEqual(
      expect.arrayContaining(["=", "IN", "BETWEEN", "IS NULL"]),
    );
    expect(complete("status BETWEEN 1 ")).toEqual(["AND"]);
    expect(complete("status BETWEEN 1 AND ")).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    expect(complete("status IS NULL ")).toEqual(
      expect.arrayContaining(["AND", "OR"]),
    );
    expect(complete("status IN (")).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    expect(complete("status IN ('active' ")).toEqual(
      expect.arrayContaining([",", ")"]),
    );
    expect(complete("status IN ('active', ")).toEqual(
      expect.arrayContaining(["''", "'%…%'", "NULL"]),
    );
    expect(complete("status NOT IN (1 ")).toEqual(
      expect.arrayContaining([",", ")"]),
    );
  });

  it("completes IS and NOT predicate branches instead of falling back to columns", () => {
    const complete = (condition: string) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns: [{ name: "status", type: "text" }],
      }).map((item) => item.label);

    expect(complete("status IS ")).toEqual(
      expect.arrayContaining(["NULL", "NOT NULL", "TRUE", "FALSE"]),
    );
    expect(complete("status NOT ")).toEqual(
      expect.arrayContaining(["IN", "LIKE", "BETWEEN"]),
    );
    expect(complete("status IS ")).not.toContain("status");
    expect(complete("status NOT ")).not.toContain("status");
  });

  it("uses the predicate column type for useful value snippets", () => {
    const complete = (
      condition: string,
      columns: Array<{ name: string; type: string }>,
    ) =>
      localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver: "postgres",
        columns,
      }).map((item) => item.label);

    expect(
      complete("enabled = ", [{ name: "enabled", type: "boolean" }]),
    ).toEqual(expect.arrayContaining(["TRUE", "FALSE", "NULL"]));
    expect(
      complete("enabled = ", [{ name: "enabled", type: "boolean" }]),
    ).not.toContain("CURRENT_TIMESTAMP");
    expect(
      complete("created_at >= ", [
        { name: "created_at", type: "timestamp with time zone" },
      ]),
    ).toEqual(
      expect.arrayContaining(["CURRENT_DATE", "CURRENT_TIMESTAMP", "NULL"]),
    );
    expect(
      complete("amount > ", [{ name: "amount", type: "numeric(12,2)" }]),
    ).toEqual(expect.arrayContaining(["0", "1", "NULL"]));
    expect(
      complete("name LIKE ", [{ name: "name", type: "varchar" }]),
    ).toEqual(expect.arrayContaining(["''", "'%…%'", "NULL"]));
    const likePattern = localWhereCompletionCandidates({
      condition: "name LIKE ",
      cursorOffset: "name LIKE ".length,
      driver: "postgres",
      columns: [{ name: "name", type: "varchar" }],
    }).find((candidate) => candidate.label === "'%…%'");
    expect(likePattern).toMatchObject({
      insertText: "'%%' ",
      cursorOffsetFromEnd: 3,
    });
  });

  it.each([
    ["postgres", '"order"'],
    ["mysql", "`order`"],
  ] as const)("quotes reserved %s column names", (driver, identifier) => {
    expect(
      localWhereCompletionCandidates({
        condition: "ord",
        cursorOffset: 3,
        driver,
        columns: [{ name: "order" }],
      })[0]?.insertText,
    ).toBe(`${identifier} = `);
  });

  it.each([
    ['"sta', "postgres", '"status code" = ', undefined],
    ["`sta", "mysql", "`status code` = ", undefined],
    ["[sta", "sqlserver", "[status code] = ", "["],
  ])(
    "matches an unfinished quoted %s identifier without leaving duplicate quotes",
    (condition, driver, expectedInsert, identifierQuote) => {
      const candidate = localWhereCompletionCandidates({
        condition,
        cursorOffset: condition.length,
        driver,
        identifierQuote,
        columns: [{ name: "status code", type: "text" }],
      })[0];
      expect(candidate?.label).toBe("status code");

      const range = whereReplacementRange(condition, condition.length);
      const next =
        condition.slice(0, range.start) +
        candidate!.insertText +
        condition.slice(range.end);
      expect(next).toBe(expectedInsert);
    },
  );

  it("keeps the local predicate workflow while using authoritative LSP metadata", () => {
    const merged = mergeWhereCompletionCandidates(
      [
        {
          label: "status",
          insertText: "status = ",
          detail: "Current table column",
          kind: CompletionItemKind.Field,
          sortText: "0:0000",
          source: "local",
        },
      ],
      [
        {
          label: "status",
          insertText: '"status"',
          detail: "public.users.status (text)",
          kind: CompletionItemKind.Field,
          sortText: "0001",
        },
      ],
    );
    expect(merged).toEqual([
      expect.objectContaining({
        label: "status",
        insertText: "status = ",
        detail: "public.users.status (text)",
        source: "lsp",
      }),
    ]);
  });
});

const matrixColumns = [
  { name: "active", type: "boolean" },
  { name: "age", type: "numeric(20, 4)" },
  { name: "created_at", type: "timestamp" },
  { name: "display name", type: "varchar(120)" },
  { name: "status", type: "varchar(32)" },
];

function completeMatrix(
  condition: string,
  driver: "postgres" | "mysql" = "postgres",
) {
  return localWhereCompletionCandidates({
    condition,
    cursorOffset: condition.length,
    driver,
    columns: matrixColumns,
  });
}

function candidateLabels(candidates: WhereCompletionCandidate[]) {
  return candidates.map((candidate) => candidate.label);
}

describe("WHERE completion context matrix", () => {
  it.each(["", "status = 'ready' AND ", "status = 'ready' OR ", "("])(
    "offers predicate operands after %j",
    (condition) => {
      expect(candidateLabels(completeMatrix(condition))).toEqual(
        expect.arrayContaining(["active", "age", "status", "NOT"]),
      );
    },
  );

  it("keeps a leading NOT in operand context but scopes column NOT to operators", () => {
    expect(candidateLabels(completeMatrix("NOT "))).toEqual(
      expect.arrayContaining(["active", "age", "status"]),
    );
    expect(candidateLabels(completeMatrix("status NOT "))).toEqual([
      "IN",
      "LIKE",
      "BETWEEN",
    ]);
    expect(candidateLabels(completeMatrix("status IS NOT "))).toEqual([
      "NULL",
      "TRUE",
      "FALSE",
      "UNKNOWN",
    ]);
  });

  it("keeps ILIKE product-scoped", () => {
    expect(candidateLabels(completeMatrix('"display name" '))).toContain(
      "ILIKE",
    );
    expect(candidateLabels(completeMatrix("status ", "mysql"))).not.toContain(
      "ILIKE",
    );
  });

  it.each([
    ["active = ", ["TRUE", "FALSE", "NULL"]],
    ["age >= ", ["0", "1", "NULL"]],
    [
      "created_at < ",
      ["''", "CURRENT_DATE", "CURRENT_TIMESTAMP", "NULL"],
    ],
    ["status = ", ["''", "'%…%'", "NULL"]],
  ])("offers typed literals for %j", (condition, expected) => {
    expect(candidateLabels(completeMatrix(condition))).toEqual(expected);
  });

  it("places the caret inside editable quoted literals", () => {
    const literal = completeMatrix("status = ").find(
      ({ label }) => label === "''",
    );
    expect(literal).toMatchObject({
      insertText: "'' ",
      cursorOffsetFromEnd: 2,
    });
  });

  it("inserts BETWEEN and IN continuations at the caret without replacing values", () => {
    expect(completeMatrix("age BETWEEN 1")).toEqual([
      expect.objectContaining({
        label: "AND",
        insertText: " AND ",
        replacementRange: { start: 13, end: 13 },
      }),
    ]);
    expect(
      completeMatrix("age BETWEEN 1 AND ").map(({ label }) => label),
    ).toEqual(["0", "1", "NULL"]);
    expect(completeMatrix("age IN (1")).toEqual([
      expect.objectContaining({
        label: ",",
        replacementRange: { start: 9, end: 9 },
      }),
      expect.objectContaining({
        label: ")",
        replacementRange: { start: 9, end: 9 },
      }),
    ]);
  });

  it("continues completed predicates without consuming the final literal", () => {
    expect(completeMatrix("status IS NULL")).toEqual([
      expect.objectContaining({
        label: "AND",
        insertText: " AND ",
        replacementRange: { start: 14, end: 14 },
      }),
      expect.objectContaining({ label: "OR", insertText: " OR " }),
    ]);
  });
});
