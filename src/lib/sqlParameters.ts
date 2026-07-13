import {
  sqlPlaceholderSpans,
  type SqlPlaceholderKind,
  type SqlPlaceholderSpan,
} from "@/lib/sqlAnalysis";

export type SqlParameterMode = "quoted" | "raw" | "null";

export type SqlParameterValue = {
  mode: SqlParameterMode;
  value?: string;
};

export type SqlParameterDefinition = {
  key: string;
  label: string;
  token: string;
  kind: SqlPlaceholderKind;
  occurrences: number;
  spans: SqlPlaceholderSpan[];
};

export type SqlParameterIssue = {
  key: string;
  label: string;
  message: string;
};

export type SqlParameterCompilation = {
  sql: string;
  issues: SqlParameterIssue[];
};

function parameterKey(
  token: string,
  kind: SqlPlaceholderKind,
  anonymousIndex: number
) {
  // Anonymous question marks are positional. Every occurrence is a separate
  // value, while numbered and named placeholders intentionally share values.
  if (kind === "questionMark" && token === "?") {
    return `${kind}:anonymous:${anonymousIndex}`;
  }
  return `${kind}:${token}`;
}

export function extractSqlParameters(
  sql: string,
  dialect?: string | null
): SqlParameterDefinition[] {
  const parameters: SqlParameterDefinition[] = [];
  const parameterIndex = new Map<string, number>();
  let anonymousIndex = 0;

  for (const span of sqlPlaceholderSpans(sql, dialect)) {
    const token = sql.slice(span.start, span.end);
    if (span.kind === "questionMark" && token === "?") {
      anonymousIndex += 1;
    }
    const key = parameterKey(token, span.kind, anonymousIndex);
    const existingIndex = parameterIndex.get(key);

    if (existingIndex !== undefined) {
      const existing = parameters[existingIndex]!;
      existing.occurrences += 1;
      existing.spans.push(span);
      continue;
    }

    parameterIndex.set(key, parameters.length);
    parameters.push({
      key,
      label:
        span.kind === "questionMark" && token === "?"
          ? `? #${anonymousIndex}`
          : token,
      token,
      kind: span.kind,
      occurrences: 1,
      spans: [span],
    });
  }

  return parameters;
}

export function quoteSqlText(value: string, dialect?: string | null) {
  const normalizedDialect = String(dialect || "").trim().toLowerCase();

  if (["postgres", "postgresql", "pgsql", "psql"].includes(normalizedDialect)) {
    let suffix = 0;
    let delimiter = "$oxide$";
    while (value.includes(delimiter)) {
      suffix += 1;
      delimiter = `$oxide_${suffix}$`;
    }
    return `${delimiter}${value}${delimiter}`;
  }

  if (["mysql", "mariadb"].includes(normalizedDialect) && value.length > 0) {
    const bytes = new TextEncoder().encode(value);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `CONVERT(0x${hex} USING utf8mb4)`;
  }

  return `'${value.replace(/'/g, "''")}'`;
}

function replacementSql(value: SqlParameterValue, dialect?: string | null) {
  switch (value.mode) {
    case "null":
      return { value: "NULL" };
    case "raw": {
      const raw = (value.value || "").trim();
      return raw
        ? { value: raw }
        : { error: "Enter a SQL expression for Raw SQL mode." };
    }
    case "quoted": {
      const text = value.value || "";
      return text.includes("\0")
        ? { error: "Text values cannot contain a null character." }
        : { value: quoteSqlText(text, dialect) };
    }
  }
}

export function compileSqlParameters(
  sql: string,
  values: Readonly<Record<string, SqlParameterValue | undefined>>,
  dialect?: string | null
): SqlParameterCompilation {
  const parameters = extractSqlParameters(sql, dialect);
  const issues: SqlParameterIssue[] = [];
  const replacements = new Map<number, { end: number; value: string }>();

  for (const parameter of parameters) {
    const configured = values[parameter.key];
    if (!configured) {
      issues.push({
        key: parameter.key,
        label: parameter.label,
        message: "Choose a value before running.",
      });
      continue;
    }

    const replacement = replacementSql(configured, dialect);
    if (replacement.error || replacement.value === undefined) {
      issues.push({
        key: parameter.key,
        label: parameter.label,
        message: replacement.error || "Invalid parameter value.",
      });
      continue;
    }

    for (const span of parameter.spans) {
      replacements.set(span.start, {
        end: span.end,
        value: replacement.value,
      });
    }
  }

  let compiled = "";
  let cursor = 0;
  for (const span of sqlPlaceholderSpans(sql, dialect)) {
    compiled += sql.slice(cursor, span.start);
    const replacement = replacements.get(span.start);
    compiled += replacement?.value ?? sql.slice(span.start, span.end);
    cursor = span.end;
  }
  compiled += sql.slice(cursor);

  return { sql: compiled, issues };
}
