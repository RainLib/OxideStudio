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

const IDENTIFIER_PREFIX = /([_\p{ID_Start}][$@#_\u200c\u200d\p{ID_Continue}]*)$/u;
const QUALIFIED_PREFIX = /[_\p{ID_Start}][$@#_\u200c\u200d\p{ID_Continue}]*\s*\.\s*(?:[_\p{ID_Start}][$@#_\u200c\u200d\p{ID_Continue}]*)?$/u;
const POSITIONAL_KEYWORDS = /\b(?:SELECT|DISTINCT|FROM|JOIN|ON|USING|WHERE|AND|OR|HAVING|GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|INSERT\s+INTO|VALUES|UPDATE|SET|DELETE\s+FROM|RETURNING|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|REFERENCES|BY)\s*$/iu;

export function sqlCompletionIdentifierPrefix(textBeforeCursor: string) {
  return textBeforeCursor.match(IDENTIFIER_PREFIX)?.[1] || "";
}

function sqlCompletionIsSuppressed(textBeforeCursor: string) {
  let lineComment = false;
  let blockComment = false;
  let stringQuote = false;
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
    } else if (character === "/" && next === "*") {
      blockComment = true;
      offset += 2;
    } else if (character === "'") {
      stringQuote = true;
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
): SqlCompletionTriggerDecision {
  if (sqlCompletionIsSuppressed(textBeforeCursor)) {
    return { allowed: false, reason: "suppressed" };
  }
  if (explicit) return { allowed: true, reason: "explicit" };
  if (mode === "manual") return { allowed: false, reason: "manual" };

  const prefix = sqlCompletionIdentifierPrefix(textBeforeCursor);
  if (prefix) return { allowed: true, reason: "prefix" };
  if (QUALIFIED_PREFIX.test(textBeforeCursor)) {
    return { allowed: true, reason: "qualifier" };
  }
  if (mode === "positional" && positionalCompletionEligible(textBeforeCursor)) {
    return { allowed: true, reason: "position" };
  }
  return { allowed: false, reason: "notEligible" };
}
