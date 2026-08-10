import {
  CompletionItemKind,
  type CompletionItem,
} from "@/services/lsp/types";
import { sqlStatementBeforeCursor } from "@/lib/queryEditorCachedCompletion";
import {
  sqlCommandSnippetCompletions,
  type SqlCommandSnippetOptions,
} from "./sqlCommandSnippets";

/**
 * Small, deterministic completion layer used only when the semantic server
 * has no answer for the current document revision. It is intentionally about
 * SQL grammar rather than database metadata: table and field suggestions stay
 * owned by the LSP or the scoped Explorer cache.
 *
 * This keeps a second statement usable while a server is recovering from an
 * incomplete preceding statement or has not indexed the current revision yet.
 */
const STATEMENT_STARTERS = [
  "SELECT",
  "WITH",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "EXPLAIN",
  "SHOW",
  "DESCRIBE",
] as const;

const POSTGRES_STATEMENT_STARTERS = ["CALL", "DO"] as const;
const MYSQL_STATEMENT_STARTERS = ["CALL", "REPLACE"] as const;
const ORACLE_STATEMENT_STARTERS = ["MERGE INTO", "DECLARE", "BEGIN"] as const;
const SQLSERVER_STATEMENT_STARTERS = [
  "MERGE",
  "EXEC",
  "EXECUTE",
  "BEGIN TRANSACTION",
] as const;
const MANTICORE_STATEMENT_STARTERS = [
  "SHOW TABLES",
  "SHOW META",
  "FACET",
  "CALL",
] as const;
const CLICKHOUSE_STATEMENT_STARTERS = ["OPTIMIZE TABLE", "SYSTEM", "KILL QUERY"] as const;

const SELECT_CONTINUATIONS = [
  "DISTINCT",
  "*",
  "FROM",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "LIMIT",
] as const;

const WHERE_OPERATORS = [
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "IN",
  "NOT IN",
  "LIKE",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
  "AND",
  "OR",
] as const;

const ORDER_CONTINUATIONS = ["ASC", "DESC", "NULLS FIRST", "NULLS LAST"] as const;

// Keep syntax fallback compatible with the identifier forms supported by the
// bundled SQL dialects. Metadata completion remains authoritative for actual
// names; this only recognizes a completed field so the next predicate/sort
// token is still offered while LSP is cold or rebuilding its schema cache.
const SQL_IDENTIFIER_SEGMENT =
  '(?:[_\\p{ID_Start}][$@#_\\u200c\\u200d\\p{ID_Continue}]*|"(?:[^"]|"")+"|`[^`]+`|\\[[^\\]]+\\])';
const SQL_IDENTIFIER_REFERENCE = `${SQL_IDENTIFIER_SEGMENT}(?:\\s*\\.\\s*${SQL_IDENTIFIER_SEGMENT})*`;
const CONDITION_FIELD_AT_CURSOR = new RegExp(
  `\\b(?:WHERE|HAVING|ON)\\s+${SQL_IDENTIFIER_REFERENCE}\\s*$`,
  "iu",
);
const ORDER_FIELD_AT_CURSOR = new RegExp(
  `\\bORDER\\s+BY\\s+${SQL_IDENTIFIER_REFERENCE}\\s*$`,
  "iu",
);

function currentStatementFragment(textBeforeCursor: string) {
  return sqlStatementBeforeCursor(textBeforeCursor);
}

function trailingWord(text: string) {
  return text.match(/([A-Za-z_][A-Za-z0-9_]*)$/)?.[1]?.toUpperCase() || "";
}

function grammarItems(
  labels: readonly string[],
  kind: CompletionItemKind,
  detail: string,
): CompletionItem[] {
  return labels.map((label, index) => ({
    label,
    kind,
    detail,
    insertText: label,
    sortText: `9:${String(index).padStart(2, "0")}:${label}`,
  }));
}

function normalizedDriver(driver?: string | null) {
  const normalized = driver?.trim().toLocaleLowerCase() || "";
  if (["postgresql", "pgsql"].includes(normalized)) return "postgres";
  if (normalized === "mariadb") return "mysql";
  return normalized;
}

/**
 * Keep statement-level grammar recommendations product-scoped.  A generic
 * SQL LSP cannot safely infer whether `DO`, `EXEC`, or Manticore's `FACET`
 * exists, while the selected connection driver can.
 */
function statementStartersForProduct(options: SqlCommandSnippetOptions) {
  const driver = normalizedDriver(options.driver);
  const productStarters =
    ["postgres", "cockroachdb", "yugabytedb", "neon", "supabase", "timescaledb"].includes(driver)
      ? POSTGRES_STATEMENT_STARTERS
      : ["mysql", "tidb", "oceanbase", "singlestore"].includes(driver)
        ? MYSQL_STATEMENT_STARTERS
        : ["oracle", "oceanbase-oracle"].includes(driver)
          ? ORACLE_STATEMENT_STARTERS
          : driver === "sqlserver"
            ? SQLSERVER_STATEMENT_STARTERS
            : driver === "manticoresearch"
              ? MANTICORE_STATEMENT_STARTERS
              : driver === "clickhouse"
                ? CLICKHOUSE_STATEMENT_STARTERS
                : [];
  return [...new Set([...STATEMENT_STARTERS, ...productStarters])];
}

/**
 * Returns only syntactic continuations that are valid at a statement boundary
 * or immediately after a completed SQL clause. It never attempts to guess a
 * table or field, so it is safe to merge after an empty LSP response.
 */
export function sqlSyntaxFallbackCompletions(
  textBeforeCursor: string,
  options: SqlCommandSnippetOptions = {},
): CompletionItem[] {
  if (options.supportsSqlQuery === false) return [];
  const statement = currentStatementFragment(textBeforeCursor);
  const trimmed = statement.trim();
  const word = trailingWord(statement);

  // A completed `SELECT` is not an incomplete statement starter. Keep this
  // before the partial-token branch so Ctrl+Space (or an LSP recovery) after
  // the keyword offers its clauses instead of proposing `SELECT` again.
  if (word === "SELECT") {
    return grammarItems(
      SELECT_CONTINUATIONS,
      CompletionItemKind.Keyword,
      "SELECT clause",
    );
  }

  if (
    !trimmed ||
    (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) && !/\s$/.test(statement))
  ) {
    return [
      ...sqlCommandSnippetCompletions(statement, options),
      ...grammarItems(
        statementStartersForProduct(options),
        CompletionItemKind.Keyword,
        "SQL statement",
      ),
    ];
  }

  if (/\bSELECT\s+(?:DISTINCT\s+)?$/i.test(statement)) {
    return grammarItems(
      SELECT_CONTINUATIONS,
      CompletionItemKind.Keyword,
      "SELECT clause",
    );
  }

  if (/\b(?:WHERE|HAVING|ON)\s*$/i.test(statement)) {
    return grammarItems(
      WHERE_OPERATORS,
      CompletionItemKind.Operator,
      "Condition operator",
    );
  }

  if (CONDITION_FIELD_AT_CURSOR.test(statement)) {
    return grammarItems(
      WHERE_OPERATORS,
      CompletionItemKind.Operator,
      "Condition operator",
    );
  }

  if (ORDER_FIELD_AT_CURSOR.test(statement)) {
    return grammarItems(
      ORDER_CONTINUATIONS,
      CompletionItemKind.Keyword,
      "ORDER BY direction",
    );
  }

  return [];
}
