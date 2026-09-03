export interface ExplorerSearchPattern {
  readonly query: string;
  readonly regexMode: boolean;
  readonly invalid: boolean;
  readonly error: string | null;
  matches(...values: Array<unknown>): boolean;
}

/**
 * Compile once per deferred query. Regex search is deliberately a local,
 * read-only projection: callers must not forward the expression to a driver.
 */
export function compileExplorerSearchPattern(
  query: string,
  regexMode: boolean,
): ExplorerSearchPattern {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      query: "",
      regexMode,
      invalid: false,
      error: null,
      matches: () => true,
    };
  }

  if (!regexMode) {
    const normalizedQuery = trimmedQuery.toLocaleLowerCase();
    return {
      query: trimmedQuery,
      regexMode: false,
      invalid: false,
      error: null,
      matches: (...values) =>
        values.some((value) =>
          String(value ?? "")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        ),
    };
  }

  try {
    const expression = new RegExp(trimmedQuery, "i");
    return {
      query: trimmedQuery,
      regexMode: true,
      invalid: false,
      error: null,
      matches: (...values) =>
        values.some((value) => expression.test(String(value ?? ""))),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      query: trimmedQuery,
      regexMode: true,
      invalid: true,
      error: message,
      matches: () => false,
    };
  }
}
