import {
  CompletionItemKind,
  type CompletionItem,
} from "@/services/lsp/types";

const DEFAULT_ROW_LIMIT = 100;

export type SqlCommandSnippetOptions = {
  driver?: string | null;
  supportsSqlQuery?: boolean;
};

type SqlCommandSnippet = {
  prefix: string;
  label: string;
  detail: string;
  body: (driver: string) => string;
};

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

const COMMON_SQL_COMMAND_SNIPPETS: readonly SqlCommandSnippet[] = [
  {
    prefix: "sel",
    label: "sel · select rows",
    detail: "Bounded SELECT template",
    body: selectRowsBody,
  },
  {
    prefix: "ins",
    label: "ins · insert row",
    detail: "INSERT template",
    body: () =>
      "INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});",
  },
  {
    prefix: "upd",
    label: "upd · update rows",
    detail: "UPDATE template with a WHERE guard",
    body: updateRowsBody,
  },
  {
    prefix: "cte",
    label: "cte · common table expression",
    detail: "CTE query template",
    body: () =>
      "WITH ${1:name} AS (\n  SELECT ${2:*}\n  FROM ${3:table}\n)\nSELECT *\nFROM ${1:name};",
  },
  {
    prefix: "ct",
    label: "ct · create table",
    detail: "CREATE TABLE template",
    body: () => "CREATE TABLE ${1:table} (\n  ${2:column} ${3:type}\n);",
  },
  {
    prefix: "at",
    label: "at · add column",
    detail: "Dialect-aware ALTER TABLE template",
    body: addColumnBody,
  },
  {
    prefix: "idx",
    label: "idx · create index",
    detail: "CREATE INDEX template",
    body: () =>
      "CREATE INDEX ${1:index_name}\nON ${2:table} (${3:column});",
  },
  {
    prefix: "del",
    label: "del · delete rows",
    detail: "DELETE template with a WHERE guard",
    body: () => "DELETE FROM ${1:table}\nWHERE ${2:condition};",
  },
];

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
  return COMMON_SQL_COMMAND_SNIPPETS.filter(
    (snippet) =>
      !prefix ||
      snippet.prefix.startsWith(prefix) ||
      snippet.label.toLowerCase().startsWith(prefix),
  ).map((snippet, index) => ({
    label: snippet.label,
    kind: CompletionItemKind.Snippet,
    detail: snippet.detail,
    documentation:
      "Common SQL command template adapted to the current database product.",
    filterText: `${snippet.prefix} ${snippet.label}`,
    insertText: snippet.body(driver),
    insertTextFormat: 2,
    sortText: `4:${String(index).padStart(2, "0")}:${snippet.prefix}`,
  }));
}
