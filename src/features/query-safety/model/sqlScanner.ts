export function splitSqlStatements(query: string, driver?: string | null) {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag: string | null = null;
  const normalizedDriver = String(driver || "")
    .trim()
    .toLowerCase();
  const isMysql =
    normalizedDriver === "mysql" || normalizedDriver === "mariadb";
  const isPostgres = ["postgres", "postgresql", "pgsql", "psql"].includes(
    normalizedDriver,
  );

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    const next = query[index + 1] ?? "";

    if (dollarQuoteTag) {
      if (query.startsWith(dollarQuoteTag, index)) {
        current += " ".repeat(dollarQuoteTag.length);
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        current += " ";
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      if (isPostgres && char === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
        continue;
      }
      if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        current += " ";
      }
      continue;
    }

    if (
      !quote &&
      char === "-" &&
      next === "-" &&
      (!isMysql || /\s/.test(query[index + 2] ?? ""))
    ) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!quote && isMysql && char === "#") {
      lineComment = true;
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }

    if (!quote && isPostgres && char === "$") {
      const tag = query
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        dollarQuoteTag = tag;
        current += " ".repeat(tag.length);
        index += tag.length - 1;
        continue;
      }
    }

    if (quote) {
      current += char;
      if (char === "\\" && next) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const statement = current.trim();
  if (statement) statements.push(statement);
  return statements;
}

export function sqlKeywordText(statement: string) {
  let result = "";
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index]!;
    const next = statement[index + 1] ?? "";

    if (quote) {
      result += " ";
      if (char === "\\" && next) {
        result += " ";
        index += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          result += " ";
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += " ";
      continue;
    }

    result += char;
  }

  return result;
}
