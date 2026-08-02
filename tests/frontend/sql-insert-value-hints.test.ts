import { describe, expect, it } from "vitest";
import { sqlInsertValueHints } from "@/lib/sqlInsertValueHints";

describe("sqlInsertValueHints", () => {
  it("labels each explicit INSERT VALUES expression, including repeated rows", () => {
    const sql = "INSERT INTO public.users (id, name, enabled) VALUES (1, 'Ada', TRUE), (2, 'Lin', FALSE);";
    const hints = sqlInsertValueHints(sql);

    expect(hints.map((hint) => hint.column)).toEqual([
      "id",
      "name",
      "enabled",
      "id",
      "name",
      "enabled",
    ]);
    expect(hints.map((hint) => sql.slice(hint.offset, hint.offset + 1))).toEqual([
      "1",
      "'",
      "T",
      "2",
      "'",
      "F",
    ]);
  });

  it("does not inspect implicit columns, strings, comments, or INSERT SELECT", () => {
    expect(sqlInsertValueHints("INSERT INTO users VALUES (1, 'Ada')")).toEqual([]);
    expect(
      sqlInsertValueHints("-- INSERT INTO hidden (a) VALUES (1)\nSELECT 'INSERT INTO hidden (a) VALUES (2)';"),
    ).toEqual([]);
    expect(
      sqlInsertValueHints("INSERT INTO users (id, name) SELECT id, name FROM staging"),
    ).toEqual([]);
  });

  it("keeps commas in nested expressions and quoted identifiers positional", () => {
    const sql = 'INSERT INTO "users" ("id", "payload") VALUES (coalesce(1, 2), json_object(\'name\', \'Ada\'));';
    const hints = sqlInsertValueHints(sql);

    expect(hints.map((hint) => hint.column)).toEqual(["id", "payload"]);
    expect(sql.slice(hints[1]?.offset || 0, (hints[1]?.offset || 0) + 4)).toBe("json");
  });
});
