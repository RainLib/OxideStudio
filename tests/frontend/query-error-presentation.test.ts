import { describe, expect, it } from "vitest";
import {
  extractQueryExecutionError,
  isMissingConnectionSession,
  presentQueryError,
} from "@/lib/queryErrorPresentation";
import { ApiError } from "@/services/tauri";

describe("query error presentation", () => {
  it("recognizes both legacy and structured missing-session failures", () => {
    expect(
      isMissingConnectionSession(
        new Error("Connection not found: internal-connection-id"),
      ),
    ).toBe(true);
    expect(
      isMissingConnectionSession(
        new ApiError(
          "The live connection session is not active.",
          "CONNECTION_SESSION_NOT_FOUND",
        ),
      ),
    ).toBe(true);
  });

  it("explains a stale connection without making the UUID the primary error", () => {
    const presentation = presentQueryError(
      "Connection not found: internal-connection-id",
      "Search Production",
    );

    expect(presentation.title).toBe("Data source session expired");
    expect(presentation.description).toContain("Search Production");
    expect(presentation.description).not.toContain("internal-connection-id");
    expect(presentation.suggestion).toContain("reconnect automatically");
    expect(presentation.technicalDetails).toContain("internal-connection-id");
  });

  it("validates database diagnostics and converts PostgreSQL character positions to Monaco offsets", () => {
    const sql = "SELECT '🚀';\nSELECT FROM users";
    const detail = extractQueryExecutionError(
      new ApiError("syntax error at or near FROM", "QUERY_EXECUTION_FAILED", null, {
        context: {
          databaseError: {
            driver: "postgres",
            sqlState: "42601",
            severity: "ERROR",
            position: 8,
            table: " users ",
            column: "unsafe\ncolumn",
          },
        },
      }),
      "SELECT FROM users",
      sql,
      13,
    );

    expect(detail.database).toMatchObject({
      driver: "postgres",
      sqlState: "42601",
      position: 8,
      executionLine: 1,
      executionColumn: 8,
      documentOffset: 20,
      documentEndOffset: 21,
      documentLine: 2,
      documentColumn: 8,
      documentExecutionRange: {
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 18,
      },
      table: "users",
    });
    expect(detail.database?.column).toBeUndefined();
  });

  it("maps Oracle Agent absolute positions to the complete invalid identifier", () => {
    const executedSql = "SELECT bad.* FROM dual t";
    const documentSql = `SELECT '🚀';\n${executedSql}`;
    const sourceStartOffset = documentSql.indexOf(executedSql);
    const detail = extractQueryExecutionError(
      new ApiError(
        'ORA-00904: "BAD": invalid identifier error occur at position: 11',
        "QUERY_EXECUTION_FAILED",
        null,
        {
          context: {
            databaseError: { driver: "database" },
          },
        },
      ),
      executedSql,
      documentSql,
      sourceStartOffset,
    );

    expect(detail.database).toMatchObject({
      driver: "database",
      documentOffset: sourceStartOffset + 7,
      documentEndOffset: sourceStartOffset + 10,
      documentLine: 2,
      documentColumn: 8,
    });
    expect(
      documentSql.slice(
        detail.database?.documentOffset,
        detail.database?.documentEndOffset,
      ),
    ).toBe("bad");
  });

  it("preserves quoted Oracle identifier casing when selecting an error range", () => {
    const sql = 'SELECT "X".*, "x".* FROM dual t';
    const detail = extractQueryExecutionError(
      new ApiError(
        'ORA-00904: "x": invalid identifier error occurred at position: 18',
        "QUERY_EXECUTION_FAILED",
        null,
        {
          context: {
            databaseError: { driver: "database" },
          },
        },
      ),
      sql,
      sql,
      0,
    );

    expect(detail.database).toMatchObject({
      documentOffset: 15,
      documentEndOffset: 16,
    });
    expect(
      sql.slice(
        detail.database?.documentOffset,
        detail.database?.documentEndOffset,
      ),
    ).toBe("x");
  });

  it("accepts zero and rejects malformed Oracle Agent positions", () => {
    const first = extractQueryExecutionError(
      new ApiError(
        "ORA-00900: invalid SQL statement error occur at position: 0",
        "QUERY_EXECUTION_FAILED",
        null,
        { context: { databaseError: { driver: "database" } } },
      ),
      "SELEC 1 FROM dual",
      "SELEC 1 FROM dual",
      0,
    );
    expect(first.database).toMatchObject({
      documentOffset: 0,
      documentEndOffset: 1,
    });

    const invalid = extractQueryExecutionError(
      new ApiError(
        "ORA-00900: invalid SQL statement error occur at position: 99",
        "QUERY_EXECUTION_FAILED",
        null,
        { context: { databaseError: { driver: "database" } } },
      ),
      "SELECT 1",
      "SELECT 1",
      0,
    );
    expect(invalid.database?.documentOffset).toBeUndefined();
    expect(invalid.database?.documentEndOffset).toBeUndefined();
  });

  it("presents constraint diagnostics as compact actionable metadata", () => {
    const detail = extractQueryExecutionError(
      new ApiError("duplicate key value", "QUERY_EXECUTION_FAILED", null, {
        retryable: false,
        context: {
          databaseError: {
            driver: "postgres",
            sqlState: "23505",
            kind: "uniqueViolation",
            constraint: "users_email_key",
          },
        },
      }),
      "INSERT INTO users VALUES (1)",
      "INSERT INTO users VALUES (1)",
      0,
    );
    const presentation = presentQueryError(
      detail.message,
      "Postgres",
      detail,
    );

    expect(presentation.retryable).toBe(false);
    expect(presentation.suggestion).toContain("conflicting key value");
    expect(presentation.metadata).toEqual([
      { label: "SQLSTATE", value: "23505" },
      { label: "Constraint", value: "users_email_key" },
    ]);
  });
});
