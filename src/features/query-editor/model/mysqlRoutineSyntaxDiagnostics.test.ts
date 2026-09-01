import { describe, expect, it } from "vitest";
import {
  analyzeMysqlRoutineSyntax,
  isMysqlRoutineParserDiagnostic,
  supportsMysqlRoutineSyntaxDiagnostics,
} from "./mysqlRoutineSyntaxDiagnostics";

describe("MySQL routine syntax diagnostics", () => {
  it("reports trailing parameters and procedure RETURN without scanning comments or strings", () => {
    const sql = `DROP PROCEDURE IF EXISTS proc_check;
CREATE PROCEDURE proc_check(
  IN account_name VARCHAR(100),
)
run: BEGIN
  SELECT 'RETURN;,)' AS message;
  -- RETURN in a comment is ignored
  RETURN;
END;
SELECT 1;`;
    const analysis = analyzeMysqlRoutineSyntax(sql);

    expect(analysis.skippedOversizedDocument).toBe(false);
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MYSQL001",
      "MYSQL002",
    ]);
    expect(analysis.routineRanges).toHaveLength(1);
    expect(sql.slice(analysis.routineRanges[0]!.from, analysis.routineRanges[0]!.to)).not.toContain(
      "SELECT 1",
    );
  });

  it("requires a function RETURN expression and accepts unary or quoted expressions", () => {
    expect(
      analyzeMysqlRoutineSyntax("CREATE FUNCTION answer() RETURNS INT BEGIN RETURN; END;")
        .diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(["MYSQL003"]);
    expect(
      analyzeMysqlRoutineSyntax("CREATE FUNCTION answer() RETURNS INT BEGIN RETURN -1; END;")
        .diagnostics,
    ).toEqual([]);
    expect(
      analyzeMysqlRoutineSyntax("CREATE FUNCTION answer() RETURNS VARCHAR(8) RETURN 'ok';")
        .diagnostics,
    ).toEqual([]);
  });

  it("uses custom delimiters to isolate multiple routines from ordinary SQL", () => {
    const sql = `DELIMITER $$
CREATE PROCEDURE first_proc() BEGIN RETURN; END$$
CREATE FUNCTION second_func() RETURNS INT RETURN$$
DELIMITER ;
SELECT missing_column FROM users;`;
    const analysis = analyzeMysqlRoutineSyntax(sql);

    expect(analysis.routineRanges).toHaveLength(2);
    expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MYSQL002",
      "MYSQL003",
    ]);
    expect(
      analysis.routineRanges.some((range) =>
        sql.slice(range.from, range.to).includes("missing_column"),
      ),
    ).toBe(false);
  });

  it("keeps nested BEGIN and CASE semicolons inside one routine range", () => {
    const sql = `CREATE PROCEDURE update_status()
BEGIN
  BEGIN SET @nested = 1; END;
  SET @status_code = CASE WHEN 1 = 1 THEN 1 ELSE 0 END;
  IF @status_code = 1 THEN RETURN; END IF;
END;
SELECT 2;`;
    const analysis = analyzeMysqlRoutineSyntax(sql);

    expect(analysis.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["MYSQL002"]);
    expect(sql.slice(analysis.routineRanges[0]!.from, analysis.routineRanges[0]!.to)).not.toContain(
      "SELECT 2",
    );
  });

  it("ignores non-routine CREATE statements and unsupported profiles", () => {
    expect(analyzeMysqlRoutineSyntax("CREATE TABLE t (note TEXT); SELECT 'RETURN';")).toEqual({
      diagnostics: [],
      routineRanges: [],
      skippedOversizedDocument: false,
    });
    expect(supportsMysqlRoutineSyntaxDiagnostics("mysql")).toBe(true);
    expect(supportsMysqlRoutineSyntaxDiagnostics("custom_mysql")).toBe(true);
    expect(supportsMysqlRoutineSyntaxDiagnostics("mariadb")).toBe(false);
  });

  it("recognizes only generic tree-sitter parser errors for routine suppression", () => {
    expect(
      isMysqlRoutineParserDiagnostic({ source: "tree-sitter-sql", code: "SYNTAX_ERROR" }),
    ).toBe(true);
    expect(isMysqlRoutineParserDiagnostic({ source: "oxide-sql-lsp", code: "OXIDE002" })).toBe(
      false,
    );
  });

  it("fails quiet on documents beyond the synchronous diagnostic bound", () => {
    const analysis = analyzeMysqlRoutineSyntax(" ".repeat(4 * 1024 * 1024 + 1));
    expect(analysis).toEqual({
      diagnostics: [],
      routineRanges: [],
      skippedOversizedDocument: true,
    });
  });

  it("scans a large routine body without retaining a token list", () => {
    let sql = "CREATE PROCEDURE bulk_update() BEGIN\n";
    for (let index = 0; index < 20_000; index += 1) {
      sql += `SET @value = ${index};\n`;
    }
    sql += "END; SELECT 3;";

    const analysis = analyzeMysqlRoutineSyntax(sql);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.routineRanges).toHaveLength(1);
    expect(sql.slice(analysis.routineRanges[0]!.from, analysis.routineRanges[0]!.to)).not.toContain(
      "SELECT 3",
    );
  });
});
