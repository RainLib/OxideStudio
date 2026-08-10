import {
  CompletionItemKind,
  type CompletionItem,
} from "@/services/lsp/types";
import {
  completionFilterTextForQuery,
  completionMatchScore,
} from "./completionMatch";

const DEFAULT_ROW_LIMIT = 100;

export type SqlCommandSnippetOptions = {
  driver?: string | null;
  supportsSqlQuery?: boolean;
  keywordCase?: "upper" | "lower" | "preserve";
  snippets?: readonly SqlSnippetSetting[];
};

export type SqlSnippetSetting = {
  id: string;
  prefix: string;
  label: string;
  detail: string;
  body: string;
  enabled: boolean;
};

const SQL_SNIPPET_KEYWORDS = [
  "WHEN NOT MATCHED THEN",
  "WHEN MATCHED THEN",
  "WHEN OTHERS THEN",
  "MERGE INTO",
  "UPDATE SET",
  "ALTER TABLE",
  "CREATE TABLE",
  "CREATE INDEX",
  "NOT EXISTS",
  "GROUP BY",
  "ORDER BY",
  "INSERT INTO",
  "FETCH FIRST",
  "ROWS ONLY",
  "START TRANSACTION",
  "BEGIN TRANSACTION",
  "DELETE FROM",
  "ADD COLUMN",
  "SELECT",
  "DISTINCT",
  "UPDATE",
  "VALUES",
  "WHERE",
  "FROM",
  "LIMIT",
  "ROWS",
  "ROWNUM",
  "FIRST",
  "JOIN",
  "WITH",
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "EXISTS",
  "ADD",
  "SET",
  "COMMIT",
  "ROLLBACK",
  "EXPLAIN",
  "DECLARE",
  "BEGIN",
  "EXCEPTION",
  "RAISE",
  "USING",
  "SHOW TABLES",
  "SHOW META",
  "MATCH",
  "FACET",
  "CALL",
] as const;

function applySnippetKeywordCase(
  body: string,
  keywordCase: SqlCommandSnippetOptions["keywordCase"],
) {
  if (keywordCase !== "lower") return body;
  return SQL_SNIPPET_KEYWORDS.reduce(
    (sql, keyword) =>
      sql.replace(
        new RegExp(`\\b${keyword.replace(/ /g, "\\s+")}\\b`, "gu"),
        (match) => match.toLowerCase(),
      ),
    body,
  );
}

const TOP_LIMIT_DRIVERS = new Set([
  "sqlserver",
  "access",
  "iris",
  "teradata",
]);
const FETCH_FIRST_LIMIT_DRIVERS = new Set(["dameng", "db2"]);
const ROWNUM_LIMIT_DRIVERS = new Set([
  "oracle",
  "oceanbase-oracle",
  "oscar",
]);
const PARENTHESIZED_ADD_COLUMN_DRIVERS = new Set([
  "oracle",
  "oceanbase-oracle",
  "yashandb",
  "xugu",
  "dameng",
  "iris",
  "informix",
]);
const ADD_WITHOUT_COLUMN_KEYWORD_DRIVERS = new Set([
  "sqlserver",
  "kingbase",
  "cassandra",
  "teradata",
]);

function normalizeDriver(driver?: string | null) {
  const normalized = driver?.trim().toLowerCase() || "";
  if (["postgresql", "pgsql"].includes(normalized)) return "postgres";
  if (normalized === "mariadb") return "mysql";
  if (normalized === "sqlite3") return "sqlite";
  return normalized;
}

function selectRowsBody(driver: string) {
  if (TOP_LIMIT_DRIVERS.has(driver)) {
    return `SELECT TOP \${1:${DEFAULT_ROW_LIMIT}} \${2:*}\nFROM \${3:table};`;
  }
  if (driver === "informix") {
    return `SELECT FIRST \${1:${DEFAULT_ROW_LIMIT}} \${2:*}\nFROM \${3:table};`;
  }
  if (FETCH_FIRST_LIMIT_DRIVERS.has(driver)) {
    return `SELECT \${1:*}\nFROM \${2:table}\nFETCH FIRST \${3:${DEFAULT_ROW_LIMIT}} ROWS ONLY;`;
  }
  if (driver === "firebird") {
    return `SELECT \${1:*}\nFROM \${2:table}\nROWS \${3:${DEFAULT_ROW_LIMIT}};`;
  }
  if (ROWNUM_LIMIT_DRIVERS.has(driver)) {
    return `SELECT \${1:*}\nFROM \${2:table}\nWHERE ROWNUM <= \${3:${DEFAULT_ROW_LIMIT}};`;
  }
  if (driver === "jdbc") {
    // A generic JDBC URL has no trustworthy pagination dialect until its
    // signed product profile resolves to a concrete driver identity.
    return "SELECT ${1:*}\nFROM ${2:table};";
  }
  return `SELECT \${1:*}\nFROM \${2:table}\nLIMIT \${3:${DEFAULT_ROW_LIMIT}};`;
}

function updateRowsBody(driver: string) {
  return driver === "clickhouse"
    ? "ALTER TABLE ${1:table}\nUPDATE ${2:column} = ${3:value}\nWHERE ${4:condition};"
    : "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};";
}

function addColumnBody(driver: string) {
  if (PARENTHESIZED_ADD_COLUMN_DRIVERS.has(driver)) {
    return "ALTER TABLE ${1:table}\nADD (${2:column} ${3:type});";
  }
  if (ADD_WITHOUT_COLUMN_KEYWORD_DRIVERS.has(driver)) {
    return "ALTER TABLE ${1:table}\nADD ${2:column} ${3:type};";
  }
  return "ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3:type};";
}

export const DEFAULT_SQL_COMMAND_SNIPPETS: readonly SqlSnippetSetting[] = [
  {
    id: "builtin-sel",
    prefix: "sel",
    label: "select rows",
    detail: "Bounded SELECT template",
    body: "SELECT ${1:*}\nFROM ${2:table}\nLIMIT ${3:100};",
    enabled: true,
  },
  {
    id: "builtin-ins",
    prefix: "ins",
    label: "insert row",
    detail: "INSERT template",
    body: "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});",
    enabled: true,
  },
  {
    id: "builtin-upd",
    prefix: "upd",
    label: "update rows",
    detail: "UPDATE template with a WHERE guard",
    body: "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
    enabled: true,
  },
  {
    id: "builtin-cte",
    prefix: "cte",
    label: "common table expression",
    detail: "CTE query template",
    body: "WITH ${1:name} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n)\nSELECT *\nFROM ${1:name};",
    enabled: true,
  },
  {
    id: "builtin-join",
    prefix: "join",
    label: "join tables",
    detail: "JOIN clause with linked placeholders",
    body: "JOIN ${1:table} ON ${2:left_column} = ${3:right_column}",
    enabled: true,
  },
  {
    id: "builtin-case",
    prefix: "case",
    label: "case expression",
    detail: "CASE expression",
    body: "CASE\n  WHEN ${1:condition} THEN ${2:value}\n  ELSE ${3:default}\nEND",
    enabled: true,
  },
  {
    id: "builtin-ex",
    prefix: "ex",
    label: "exists subquery",
    detail: "EXISTS predicate",
    body: "EXISTS (\n  SELECT 1\n  FROM ${1:table}\n  WHERE ${2:condition}\n)",
    enabled: true,
  },
  {
    id: "builtin-nex",
    prefix: "nex",
    label: "not exists subquery",
    detail: "NOT EXISTS predicate",
    body: "NOT EXISTS (\n  SELECT 1\n  FROM ${1:table}\n  WHERE ${2:condition}\n)",
    enabled: true,
  },
  {
    id: "builtin-ct",
    prefix: "ct",
    label: "create table",
    detail: "CREATE TABLE template",
    body: "CREATE TABLE ${1:table} (\n  ${2:column} ${3:type}\n);",
    enabled: true,
  },
  {
    id: "builtin-at",
    prefix: "at",
    label: "add column",
    detail: "Dialect-aware ALTER TABLE template",
    body: "ALTER TABLE ${1:table}\nADD COLUMN ${2:column} ${3:type};",
    enabled: true,
  },
  {
    id: "builtin-ci",
    prefix: "ci",
    label: "create index",
    detail: "CREATE INDEX template",
    body: "CREATE INDEX ${1:index_name}\nON ${2:table} (${3:column});",
    enabled: true,
  },
  {
    id: "builtin-del",
    prefix: "del",
    label: "delete rows",
    detail: "DELETE template with a WHERE guard",
    body: "DELETE FROM ${1:table}\nWHERE ${2:condition};",
    enabled: true,
  },
  {
    id: "builtin-tx",
    prefix: "tx",
    label: "transaction block",
    detail: "Transaction with commit and rollback guidance",
    body: "START TRANSACTION;\n\n${1:statement};\n\nCOMMIT;\n-- ROLLBACK;",
    enabled: true,
  },
  {
    id: "builtin-exp",
    prefix: "exp",
    label: "explain query",
    detail: "EXPLAIN query template",
    body: "EXPLAIN\nSELECT ${1:*}\nFROM ${2:table};",
    enabled: true,
  },
];

/** Additional templates exposed only by Manticore Search's SQL surface. */
export const MANTICORE_SQL_COMMAND_SNIPPETS: readonly SqlSnippetSetting[] = [
  {
    id: "builtin-manticore-match",
    prefix: "match",
    label: "match query",
    detail: "Manticore full-text MATCH predicate",
    body: "MATCH('${1:query}')",
    enabled: true,
  },
  {
    id: "builtin-manticore-facet",
    prefix: "facet",
    label: "facet",
    detail: "Manticore FACET clause",
    body: "FACET ${1:column}",
    enabled: true,
  },
  {
    id: "builtin-manticore-show-meta",
    prefix: "meta",
    label: "show meta",
    detail: "Inspect the previous Manticore query",
    body: "SHOW META;",
    enabled: true,
  },
  {
    id: "builtin-manticore-show-tables",
    prefix: "tables",
    label: "show tables",
    detail: "List Manticore tables",
    body: "SHOW TABLES;",
    enabled: true,
  },
  {
    id: "builtin-manticore-call-pq",
    prefix: "pq",
    label: "call pq",
    detail: "Run a Manticore percolate query",
    body: "CALL PQ ('${1:pq}', ('{\"${2:title}\":\"${3:query}\"}'));",
    enabled: true,
  },
];

/** Oracle-family blocks that must not leak into generic parser profiles. */
export const ORACLE_SQL_COMMAND_SNIPPETS: readonly SqlSnippetSetting[] = [
  {
    id: "builtin-oracle-merge",
    prefix: "merge",
    label: "merge rows",
    detail: "Oracle MERGE template without AS aliases",
    body: "MERGE INTO ${1:target_table} ${2:t}\nUSING ${3:source_table} ${4:s}\nON (${5:t.id = s.id})\nWHEN MATCHED THEN\n  UPDATE SET ${6:t.value = s.value}\nWHEN NOT MATCHED THEN\n  INSERT (${7:id, value})\n  VALUES (${8:s.id, s.value});",
    enabled: true,
  },
  {
    id: "builtin-oracle-plsql",
    prefix: "plsql",
    label: "PL/SQL block",
    detail: "Oracle anonymous PL/SQL block with exception handling",
    body: "DECLARE\n  ${1:variable_name} ${2:VARCHAR2(100)};\nBEGIN\n  ${3:statement};\nEXCEPTION\n  WHEN OTHERS THEN\n    ${4:RAISE};\nEND;\n/",
    enabled: true,
  },
];

/** IBM Db2 special-register inspection, kept on the reviewed Db2 route. */
export const DB2_SQL_COMMAND_SNIPPETS: readonly SqlSnippetSetting[] = [
  {
    id: "builtin-db2-registers",
    prefix: "regs",
    label: "current special registers",
    detail: "Inspect Db2 date/time and authorization special registers",
    body: "VALUES (CURRENT DATE, CURRENT TIME, CURRENT TIMESTAMP, CURRENT USER);",
    enabled: true,
  },
];

/** Dameng functions intentionally retain their documented call parentheses. */
export const DAMENG_SQL_COMMAND_SNIPPETS: readonly SqlSnippetSetting[] = [
  {
    id: "builtin-dameng-datetime",
    prefix: "dmdt",
    label: "Dameng current date/time",
    detail: "Inspect Dameng server date and timestamp functions",
    body: "SELECT SYSDATE(), CURRENT_DATE(), CURRENT_TIMESTAMP();",
    enabled: true,
  },
];

const BUILTIN_SQL_COMMAND_SNIPPETS = [
  ...DEFAULT_SQL_COMMAND_SNIPPETS,
  ...MANTICORE_SQL_COMMAND_SNIPPETS,
  ...ORACLE_SQL_COMMAND_SNIPPETS,
  ...DB2_SQL_COMMAND_SNIPPETS,
  ...DAMENG_SQL_COMMAND_SNIPPETS,
];

const ORACLE_SNIPPET_DRIVERS = new Set(["oracle", "oceanbase-oracle"]);

function appendProductSnippets(
  configuredSnippets: readonly SqlSnippetSetting[],
  productSnippets: readonly SqlSnippetSetting[],
) {
  return [
    ...configuredSnippets,
    ...productSnippets.filter(
      (candidate) =>
        !configuredSnippets.some((snippet) => snippet.id === candidate.id),
    ),
  ];
}

function commandSnippetsForProduct(driver: string) {
  if (driver === "manticoresearch") return MANTICORE_SQL_COMMAND_SNIPPETS;
  if (ORACLE_SNIPPET_DRIVERS.has(driver)) return ORACLE_SQL_COMMAND_SNIPPETS;
  if (driver === "db2") return DB2_SQL_COMMAND_SNIPPETS;
  if (driver === "dameng") return DAMENG_SQL_COMMAND_SNIPPETS;
  return [];
}

function isUnmodifiedBuiltinSnippet(snippet: SqlSnippetSetting) {
  const defaultSnippet = BUILTIN_SQL_COMMAND_SNIPPETS.find(
    (candidate) => candidate.id === snippet.id,
  );
  return Boolean(defaultSnippet && defaultSnippet.body === snippet.body);
}

function resolvedSnippetBody(snippet: SqlSnippetSetting, driver: string) {
  // A user-edited built-in is custom SQL and must not be silently replaced by
  // a dialect template. Only untouched defaults receive product adaptation.
  if (!isUnmodifiedBuiltinSnippet(snippet)) {
    return snippet.body;
  }
  switch (snippet.id) {
    case "builtin-sel":
      return selectRowsBody(driver);
    case "builtin-upd":
      return updateRowsBody(driver);
    case "builtin-at":
      return addColumnBody(driver);
    case "builtin-tx":
      return driver === "sqlserver"
        ? snippet.body.replace("START TRANSACTION", "BEGIN TRANSACTION")
        : snippet.body;
    default:
      return snippet.body;
  }
}

/**
 * Recommend bounded, cursor-navigable command templates at a statement
 * boundary. Product identity controls syntax; an LSP parser compatibility
 * baseline is deliberately not used as a substitute for vendor SQL.
 */
export function sqlCommandSnippetCompletions(
  statementFragment: string,
  options: SqlCommandSnippetOptions = {},
): CompletionItem[] {
  if (options.supportsSqlQuery === false) return [];
  const trimmed = statementFragment.trim();
  if (trimmed && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(trimmed)) return [];

  const prefix = trimmed.toLowerCase();
  const driver = normalizeDriver(options.driver);
  const configuredSnippets = options.snippets ?? DEFAULT_SQL_COMMAND_SNIPPETS;
  const productSnippets = commandSnippetsForProduct(driver);
  const snippets = appendProductSnippets(configuredSnippets, productSnippets);
  return snippets
    .map((snippet, index) => ({
      snippet,
      index,
      score: Math.max(
        completionMatchScore(snippet.prefix, prefix),
        completionMatchScore(snippet.label, prefix),
      ),
    }))
    .filter(({ snippet, score }) => snippet.enabled && score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ snippet, index, score }) => ({
      label: snippet.label,
      labelDetails: {
        detail: `  ${snippet.prefix}`,
        description: "SQL snippet",
      },
      kind: CompletionItemKind.Snippet,
      detail: snippet.detail,
      documentation:
        "Common SQL command template adapted to the current database product.",
      filterText:
        completionFilterTextForQuery(
          `${snippet.prefix} ${snippet.label}`,
          prefix,
        ) || `${snippet.prefix} ${snippet.label}`,
      insertText: isUnmodifiedBuiltinSnippet(snippet)
        ? applySnippetKeywordCase(
            resolvedSnippetBody(snippet, driver),
            options.keywordCase,
          )
        : snippet.body,
      insertTextFormat: 2,
      sortText: `${prefix === snippet.prefix.toLowerCase() ? "0" : "4"}:${String(9_999 - Math.max(0, score)).padStart(4, "0")}:${String(index).padStart(2, "0")}:${snippet.prefix}`,
    }));
}
