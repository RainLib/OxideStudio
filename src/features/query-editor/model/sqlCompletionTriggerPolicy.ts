import { cachedIdentifierFragment, cachedIdentifierQualifier, type CachedIdentifierFragment } from "./cached-completion/identifierFragments";

export type SqlCompletionTriggerMode =
  | "manual"
  | "require-prefix"
  | "positional";

export type SqlCompletionTriggerDecision = {
  allowed: boolean;
  reason:
    | "explicit"
    | "manual"
    | "prefix"
    | "qualifier"
    | "position"
    | "suppressed"
    | "notEligible";
};

export type SqlCompletionIdentifierFragment = CachedIdentifierFragment;
const POSITIONAL_KEYWORDS = /\b(?:SELECT|DISTINCT|FROM|JOIN|ON|USING|WHERE|AND|OR|HAVING|GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|INSERT\s+INTO|VALUES|UPDATE|SET|DELETE\s+FROM|RETURNING|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|REFERENCES|BY)\s*$/iu;

export function sqlCompletionIdentifierFragment(
  textBeforeCursor: string,
): SqlCompletionIdentifierFragment {
  return cachedIdentifierFragment(textBeforeCursor);
}

export function sqlCompletionIdentifierPrefix(textBeforeCursor: string) {
  return sqlCompletionIdentifierFragment(textBeforeCursor).prefix;
}

function normalizedCompletionDriver(driver?: string) {
  return driver?.trim().toLocaleLowerCase().replace(/[_\s]+/gu, "-") || "";
}

function mysqlFamilyCompletionDriver(driver: string) {
  return [
    "mysql",
    "mariadb",
    "tidb",
    "oceanbase",
    "singlestore",
    "manticore",
    "manticoresearch",
  ].includes(driver);
}

function postgresFamilyCompletionDriver(driver: string) {
  return [
    "postgres",
    "postgresql",
    "cockroachdb",
    "yugabytedb",
    "neon",
    "supabase",
    "timescaledb",
  ].includes(driver);
}

function sqlCompletionIsSuppressed(textBeforeCursor: string, driver?: string) {
  const normalizedDriver = normalizedCompletionDriver(driver);
  const mysqlFamily = mysqlFamilyCompletionDriver(normalizedDriver);
  const postgresFamily = postgresFamilyCompletionDriver(normalizedDriver);
  let lineComment = false;
  let blockComment = false;
  let stringQuote = false;
  let stringBackslashEscapes = false;
  let dollarQuote: string | null = null;

  for (let offset = 0; offset < textBeforeCursor.length; ) {
    const character = textBeforeCursor[offset]!;
    const next = textBeforeCursor[offset + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      offset += 1;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        offset += 2;
      } else {
        offset += 1;
      }
      continue;
    }
    if (dollarQuote) {
      if (textBeforeCursor.startsWith(dollarQuote, offset)) {
        offset += dollarQuote.length;
        dollarQuote = null;
      } else {
        offset += character.length;
      }
      continue;
    }
    if (stringQuote) {
      if (stringBackslashEscapes && character === "\\" && next !== undefined) {
        offset += 2;
        continue;
      }
      if (character === "'" && next === "'") {
        offset += 2;
      } else {
        if (character === "'") stringQuote = false;
        offset += 1;
      }
      continue;
    }
    if (character === "-" && next === "-") {
      lineComment = true;
      offset += 2;
    } else if (mysqlFamily && character === "#") {
      lineComment = true;
      offset += 1;
    } else if (character === "/" && next === "*") {
      blockComment = true;
      offset += 2;
    } else if (character === "'") {
      stringQuote = true;
      const previous = textBeforeCursor[offset - 1] || "";
      const beforePrevious = textBeforeCursor[offset - 2] || "";
      stringBackslashEscapes = mysqlFamily || (
        postgresFamily
        && /e/iu.test(previous)
        && !/[$@#_\p{ID_Continue}]/u.test(beforePrevious)
      );
      offset += 1;
    } else if (character === "$") {
      const tag = textBeforeCursor.slice(offset).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
      if (tag) {
        dollarQuote = tag;
        offset += tag.length;
      } else {
        offset += 1;
      }
    } else {
      offset += character.length;
    }
  }

  return lineComment || blockComment || stringQuote || dollarQuote !== null;
}

function positionalCompletionEligible(textBeforeCursor: string) {
  const trimmed = textBeforeCursor.trimEnd();
  if (!trimmed) return false;
  if (POSITIONAL_KEYWORDS.test(trimmed)) return true;
  return /(?:[,=(]|<>|!=|>=|<=|\+|-|\/|%)\s*$/u.test(trimmed);
}

export function sqlCompletionTriggerDecision(
  mode: SqlCompletionTriggerMode,
  textBeforeCursor: string,
  explicit: boolean,
  driver?: string,
): SqlCompletionTriggerDecision {
  if (sqlCompletionIsSuppressed(textBeforeCursor, driver)) {
    return { allowed: false, reason: "suppressed" };
  }
  if (explicit) return { allowed: true, reason: "explicit" };
  if (mode === "manual") return { allowed: false, reason: "manual" };

  const prefix = sqlCompletionIdentifierPrefix(textBeforeCursor);
  if (prefix) return { allowed: true, reason: "prefix" };
  if (cachedIdentifierQualifier(textBeforeCursor)) {
    return { allowed: true, reason: "qualifier" };
  }
  if (mode === "positional" && positionalCompletionEligible(textBeforeCursor)) {
    return { allowed: true, reason: "position" };
  }
  return { allowed: false, reason: "notEligible" };
}
