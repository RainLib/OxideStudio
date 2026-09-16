export function isPostgresDialect(dialect: string | null | undefined) {
  const normalized = String(dialect || "")
    .trim()
    .toLowerCase();
  return ["postgres", "postgresql", "pgsql", "psql"].includes(normalized);
}

export function isIdentifierChar(char: string) {
  return /[A-Za-z0-9_$]/.test(char);
}

export function startsHashComment(
  sql: string,
  index: number,
  dialect?: string | null,
) {
  if (sql[index] !== "#") return false;
  // PostgreSQL uses #>, #>> and #- as JSON operators. They must remain
  // visible to both SQL analysis and parameter scanning.
  if (isPostgresDialect(dialect)) {
    return false;
  }
  return index === 0 || /\s/.test(sql[index - 1] || "");
}

export function supportsPostgresDollarQuotes(
  dialect: string | null | undefined,
) {
  const normalized = String(dialect || "")
    .trim()
    .toLowerCase();
  return ["postgres", "postgresql", "pgsql", "psql"].includes(normalized);
}

export function dollarQuoteTagAt(sql: string, index: number) {
  if (sql[index] !== "$") return null;

  let end = index + 1;
  while (end < sql.length) {
    const char = sql[end] || "";
    if (char === "$") {
      return sql.slice(index, end + 1);
    }
    if (end === index + 1 && !/[A-Za-z_]/.test(char)) return null;
    if (end > index + 1 && !/[A-Za-z0-9_]/.test(char)) return null;
    end += 1;
  }

  return null;
}
