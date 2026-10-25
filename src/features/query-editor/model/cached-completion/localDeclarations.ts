import { SQL_IDENTIFIER, splitDelimitedIdentifiers } from "./syntax";
import { unquoteIdentifier } from "./lexical";
import { matchingSqlParenthesis } from "./structure";
import type { CachedSqlLocalSource } from "./types";
export type CachedLocalDeclaration = {
  columns: string[];
  localSource?: CachedSqlLocalSource;
  offset: number;
};
const head = new RegExp(`(?:\\bwith\\b|,)\\s*(?:recursive\\s+)?(${SQL_IDENTIFIER})`, "giu");
const identifier = new RegExp(`^${SQL_IDENTIFIER}$`, "u");

/** Parse balanced quoted lists, instead of stopping at ')' inside a name. */
export function localColumnList(source: string, masked: string, start: number) {
  while (/\s/u.test(masked[start] ?? "")) start++;
  if (masked[start] !== "(") return undefined;
  const close = matchingSqlParenthesis(masked, start);
  if (close < 0) return undefined;
  const raw = source.slice(start + 1, close),
    columns = splitDelimitedIdentifiers(raw);
  // splitDelimitedIdentifiers preserves escaped names; the whole list must
  // consist of identifier atoms rather than function/type expressions.
  let quote: string | undefined,
    part = "";
  const parts: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    part += ch;
    if (quote) {
      if (ch === quote) {
        if (raw[i + 1] === ch) {
          part += raw[++i];
        } else quote = undefined;
      }
    } else if (ch === '"' || ch === '`' || ch === '[') quote = ch === '[' ? ']' : ch;else if (ch === ',') {
      parts.push(part.slice(0, -1).trim());
      part = "";
    }
  }
  parts.push(part.trim());
  return {
    columns: parts.every(part => identifier.test(part)) ? columns : [],
    end: close + 1
  };
}
export function cachedLocalDeclarations(source: string, masked: string, visible: (offset: number) => boolean) {
  const declarations = new Map<string, CachedLocalDeclaration>();
  for (const match of masked.matchAll(head)) {
    if (!visible(match.index)) continue;
    let end = match.index + match[0].length;
    const list = localColumnList(source, masked, end);
    if (list) end = list.end;
    const body = masked.slice(end).match(/^\s*as\b\s*(?:(?:not\s+)?materialized\b\s*)?\(/iu);
    if (!body) continue;
    const open = end + body[0].lastIndexOf('('),
      close = matchingSqlParenthesis(masked, open);
    declarations.set(unquoteIdentifier(match[1]!).toLowerCase(), {
      columns: list?.columns ?? [],
      offset: match.index,
      ...(close >= 0 ? {
        localSource: {
          kind: "query" as const,
          start: open + 1,
          end: close,
          ...(list ? {
            columns: list.columns
          } : {})
        }
      } : {})
    });
  }
  return declarations;
}
