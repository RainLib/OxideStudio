import { unquoteIdentifier, NON_ALIAS_KEYWORDS } from "./lexical";

export const UNQUOTED_SQL_IDENTIFIER =
  '[_\\p{ID_Start}][$@#_\\u200c\\u200d\\p{ID_Continue}]*';
export const SQL_IDENTIFIER =
  `(?:"(?:""|[^"])+"|\`(?:\`\`|[^\`])+\`|\\[(?:\\]\\]|[^\\]])+\\]|${UNQUOTED_SQL_IDENTIFIER})`;
// Besides ordinary one-to-four-part names, SQL Server accepts an omitted
// schema (`database..table` and `server.database..table`). Keep the empty
// segment visible to splitQualifiedIdentifier instead of letting the matcher
// stop after the first identifier.
export const QUALIFIED_RELATION_IDENTIFIER =
  `(?:${SQL_IDENTIFIER}(?:\\s*\\.\\s*(?:${SQL_IDENTIFIER})?){0,2}\\s*\\.\\s*${SQL_IDENTIFIER}|${SQL_IDENTIFIER})(?![$@#_\\u200c\\u200d\\p{ID_Continue}]|\\s*\\.)`;
const RELATION_ALIAS_IDENTIFIER = `(?!(?:${[...NON_ALIAS_KEYWORDS].join("|")})\\b)${SQL_IDENTIFIER}`;
export const TRAILING_IDENTIFIER_FRAGMENT =
  `(?:"[^"]*|\`[^\`]*|\\[[^\\]]*|${UNQUOTED_SQL_IDENTIFIER})`;
export const RELATION_MATCHER = new RegExp(
  `\\b(from|join|update|into|apply)\\s+(?:lateral\\s+)?(${QUALIFIED_RELATION_IDENTIFIER})\\s*(?:as\\s+)?(${RELATION_ALIAS_IDENTIFIER})?`,
  "giu",
);
export const COMMA_RELATION_MATCHER = new RegExp(
  `,\\s*(${QUALIFIED_RELATION_IDENTIFIER})\\s*(?:as\\s+)?(${RELATION_ALIAS_IDENTIFIER})?`,
  "giu",
);
export const TRAILING_QUALIFIER = new RegExp(
  `(${SQL_IDENTIFIER})\\s*\\.\\s*${TRAILING_IDENTIFIER_FRAGMENT}?$`,
  "iu",
);
export const CTE_DECLARATION_MATCHER = new RegExp(
  `(?:\\bwith\\b|,)\\s*(?:recursive\\s+)?(${SQL_IDENTIFIER})(?:\\s*\\(([^)]*)\\))?\\s+as\\s*\\(`,
  "giu",
);
export const JOIN_TARGET_CONTEXT_MATCHER = new RegExp(
  `\\b(?:(?:left|right|full|inner|outer|cross|natural)\\s+)*(?:join)\\s+((?:${SQL_IDENTIFIER}\\s*\\.\\s*)*(?:${TRAILING_IDENTIFIER_FRAGMENT})?)$`,
  "iu",
);
export const RELATION_TARGET_CONTEXT_MATCHER = new RegExp(
  `\\b(?:from|join|into|update|truncate\\s+table|alter\\s+table|drop\\s+(?:table|view)|describe|desc)\\s+((?:${SQL_IDENTIFIER}\\s*\\.\\s*)*(?:${TRAILING_IDENTIFIER_FRAGMENT})?)$`,
  "iu",
);
export const SUBQUERY_RELATION_MATCHER = /(?:\b(?:from|join|apply)\s+|,\s*)(?:lateral\s+)?\(/giu;
export const TABLE_FUNCTION_RELATION_MATCHER = new RegExp(
  `(?:\\b(?:from|join|apply)\\s+|,\\s*)(?:lateral\\s+)?(${SQL_IDENTIFIER}(?:\\.${SQL_IDENTIFIER})*)\\s*\\(`,
  "giu",
);
export const COMPLETE_QUALIFIED_IDENTIFIER_MATCHER = new RegExp(
  `^${SQL_IDENTIFIER}(?:\\s*\\.\\s*${SQL_IDENTIFIER})*$`,
  "iu",
);
export const TRAILING_AS_ALIAS_MATCHER = new RegExp(
  `\\bas\\s+(${SQL_IDENTIFIER})\\s*$`,
  "iu",
);
export const TRAILING_IMPLICIT_ALIAS_MATCHER = new RegExp(
  `\\s+(${SQL_IDENTIFIER})\\s*$`,
  "iu",
);

export function splitDelimitedIdentifiers(value: string) {
  const values: string[] = [];
  let current = "";
  let quote: '"' | "`" | "[" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    const next = value[index + 1];
    if (quote === "[") {
      current += character;
      if (character === "]") {
        if (next === "]") {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) {
        if (next === quote) {
          current += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '"' || character === "`" || character === "[") {
      quote = character;
      current += character;
      continue;
    }
    if (character === ",") {
      const identifier = unquoteIdentifier(current);
      if (identifier) values.push(identifier);
      current = "";
      continue;
    }
    current += character;
  }
  const identifier = unquoteIdentifier(current);
  if (identifier) values.push(identifier);
  return values;
}
