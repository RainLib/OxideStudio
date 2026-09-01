export type DateTimeFormatterUnit = "seconds" | "milliseconds" | "auto";

export type ColumnFormatterConfig =
  | {
      kind: "datetime";
      unit: DateTimeFormatterUnit;
      pattern: string;
      timezone?: string;
    }
  | { kind: "json-path"; path: string }
  | { kind: "mask"; prefix: number; suffix: number }
  | { kind: "custom-template"; template: string };

export interface ColumnFormatterKeyParts {
  connectionId: string;
  database?: string;
  schema?: string;
  tableName: string;
  column: string;
}

export interface ColumnFormatterSourceRef {
  database?: string;
  schema?: string;
  tableName?: string;
  sourceColumn?: string;
}

export interface ColumnFormatterKeyContext {
  connectionId: string;
  database?: string;
  schema?: string;
  databaseType?: string;
  resultColumn: string;
  sourceColumn?: string;
  displaySource?: ColumnFormatterSourceRef;
  tableMeta?: {
    database?: string;
    schema?: string;
    tableName: string;
  };
}

const SUPPORTED_PATTERN_TOKENS = [
  "YYYY",
  "SSS",
  "MM",
  "DD",
  "HH",
  "mm",
  "ss",
] as const;

export const DATA_GRID_DATE_TIME_PATTERNS = [
  "YYYY-MM-DD",
  "HH:mm:ss",
  "HH:mm:ss.SSS",
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm:ss.SSS",
] as const;

export function buildColumnFormatterKey(parts: ColumnFormatterKeyParts) {
  return [
    parts.connectionId,
    parts.database ?? "",
    parts.schema ?? "",
    parts.tableName,
    parts.column,
  ].join("::");
}

/**
 * keys[0] is the canonical write key. Physical source identity always wins;
 * unresolved query columns never borrow a same-named table formatter.
 */
export function columnFormatterKeys(context: ColumnFormatterKeyContext) {
  const displaySource = context.displaySource;
  if (displaySource && !displaySource.tableName) return [];
  const tableMeta = displaySource?.tableName
    ? {
        database: displaySource.database,
        schema: displaySource.schema,
        tableName: displaySource.tableName,
      }
    : context.tableMeta;
  if (!tableMeta?.tableName) return [];

  const sourceColumn =
    displaySource?.sourceColumn ||
    context.sourceColumn ||
    context.resultColumn;
  const database = tableMeta.database?.trim() || context.database;
  const schema = tableMeta.schema ?? context.schema;
  const mysqlFamily = ["mysql", "mariadb", "tidb", "oceanbase"].includes(
    String(context.databaseType || "").toLowerCase(),
  );
  const keys = new Set<string>();
  const add = (candidateDatabase?: string, candidateSchema?: string, column = sourceColumn) =>
    keys.add(
      buildColumnFormatterKey({
        connectionId: context.connectionId,
        database: candidateDatabase,
        schema: candidateSchema,
        tableName: tableMeta.tableName,
        column,
      }),
    );

  if (mysqlFamily) add(database, "");
  add(database, schema);
  if (displaySource?.tableName) return [...keys];

  for (const candidateDatabase of new Set([
    database,
    context.database,
    context.tableMeta?.database,
  ])) {
    for (const candidateSchema of new Set([
      schema,
      context.schema,
      context.tableMeta?.schema,
      "",
      mysqlFamily ? database : undefined,
    ])) {
      add(candidateDatabase, candidateSchema, sourceColumn);
      add(candidateDatabase, candidateSchema, context.resultColumn);
    }
  }
  return [...keys];
}

export function normalizeDateTimePattern(value: unknown) {
  if (typeof value !== "string") return "";
  const pattern = value.trim();
  if (!pattern || pattern.length > 100 || pattern.includes("%")) return "";
  let index = 0;
  while (index < pattern.length) {
    const token = SUPPORTED_PATTERN_TOKENS.find((item) =>
      pattern.startsWith(item, index),
    );
    if (token) {
      index += token.length;
      continue;
    }
    const char = pattern[index]!;
    if (/[A-Za-z]/u.test(char)) return "";
    index += 1;
  }
  return pattern;
}

export function normalizeColumnFormatter(
  value: unknown,
): ColumnFormatterConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const config = value as Record<string, unknown>;
  if (config.kind === "datetime") {
    const unit = config.unit;
    const pattern = normalizeDateTimePattern(config.pattern);
    if (
      !pattern ||
      (unit !== "seconds" && unit !== "milliseconds" && unit !== "auto")
    ) {
      return undefined;
    }
    const timezone =
      typeof config.timezone === "string" && config.timezone.trim()
        ? config.timezone.trim().slice(0, 100)
        : undefined;
    if (timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
      } catch {
        return undefined;
      }
    }
    return { kind: "datetime", unit, pattern, timezone };
  }
  if (config.kind === "json-path") {
    const path = typeof config.path === "string" ? config.path.trim() : "";
    return /^\$(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/u.test(path)
      ? { kind: "json-path", path }
      : undefined;
  }
  if (config.kind === "mask") {
    if (
      !Number.isInteger(config.prefix) ||
      !Number.isInteger(config.suffix) ||
      Number(config.prefix) < 0 ||
      Number(config.suffix) < 0 ||
      Number(config.prefix) > 1_000 ||
      Number(config.suffix) > 1_000
    ) {
      return undefined;
    }
    return {
      kind: "mask",
      prefix: Number(config.prefix),
      suffix: Number(config.suffix),
    };
  }
  if (config.kind === "custom-template") {
    const template =
      typeof config.template === "string" ? config.template.trim() : "";
    return template && template.length <= 500 && template.includes("${value}")
      ? { kind: "custom-template", template }
      : undefined;
  }
  return undefined;
}

export function normalizeColumnFormatterRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, ColumnFormatterConfig> = {};
  for (const [key, candidate] of Object.entries(value).slice(0, 2_000)) {
    if (!key || key.length > 500) continue;
    const formatter = normalizeColumnFormatter(candidate);
    if (formatter) result[key] = formatter;
  }
  return result;
}

function formatterDate(value: unknown, unit: DateTimeFormatterUnit) {
  if (typeof value === "number" || /^-?\d+(?:\.\d+)?$/u.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const milliseconds =
      unit === "seconds" || (unit === "auto" && Math.abs(numeric) < 1e11)
        ? numeric * 1_000
        : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateParts(date: Date, timezone?: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function jsonPathValue(value: unknown, path: string) {
  let current =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return undefined;
          }
        })()
      : value;
  for (const match of path.slice(1).matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)\]/gu)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[match[1] ?? match[2]!];
  }
  return current;
}

export function applyColumnFormatter(
  value: unknown,
  formatter: ColumnFormatterConfig | undefined,
): string | undefined {
  if (!formatter || value == null) return undefined;
  if (formatter.kind === "datetime") {
    const date = formatterDate(value, formatter.unit);
    if (!date) return undefined;
    const parts = dateParts(date, formatter.timezone);
    return formatter.pattern.replace(
      /YYYY|MM|DD|HH|mm|ss|SSS/gu,
      (token) =>
        ({
          YYYY: parts.year,
          MM: parts.month,
          DD: parts.day,
          HH: parts.hour,
          mm: parts.minute,
          ss: parts.second,
          SSS: String(date.getMilliseconds()).padStart(3, "0"),
        })[token] || token,
    );
  }
  if (formatter.kind === "json-path") {
    const resolved = jsonPathValue(value, formatter.path);
    if (resolved === undefined) return undefined;
    return typeof resolved === "object"
      ? JSON.stringify(resolved)
      : String(resolved);
  }
  if (formatter.kind === "mask") {
    const text = String(value);
    if (text.length <= formatter.prefix + formatter.suffix) return text;
    return `${text.slice(0, formatter.prefix)}••••••${
      formatter.suffix ? text.slice(-formatter.suffix) : ""
    }`;
  }
  return formatter.template.split("${value}").join(String(value));
}
