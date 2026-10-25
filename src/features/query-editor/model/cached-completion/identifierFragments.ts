import { maskSqlCommentsAndLiterals } from "./lexical";
export type CachedIdentifierFragment = {
  prefix: string;
  replacementLength: number;
  openingQuote?: '"' | "`" | "[";
  closingQuote?: '"' | "`" | "]";
  unsupported?: true;
};
const continuation = /^[$@#_\u200c\u200d\p{ID_Continue}]$/u;
const initial = /^[_\p{ID_Start}]$/u;

/** Read only the final token. An unanchored greedy identifier regex retried
 * every character of earlier long words, making completion quadratic. */
export function plainIdentifierSuffix(value: string) {
  let start = value.length;
  while (start > 0) {
    let previous = start - 1;
    const code = value.charCodeAt(previous);
    if (code >= 0xdc00 && code <= 0xdfff && previous > 0) {
      const high = value.charCodeAt(previous - 1);
      if (high >= 0xd800 && high <= 0xdbff) previous--;
    }
    if (!continuation.test(value.slice(previous, start))) break;
    start = previous;
  }
  let skip = start;
  for (const character of value.slice(start)) {
    if (initial.test(character)) return value.slice(skip);
    skip += character.length;
  }
  return "";
}
function quotes(masked: string) {
  let active: {
    start: number;
    opening: '"' | '`' | '[';
    closing: '"' | '`' | ']';
    valid: boolean;
  } | undefined;
  let closed: {
    start: number;
    end: number;
  } | undefined;
  for (let index = 0; index < masked.length; index++) {
    const ch = masked[index]!;
    if (active) {
      if (ch === active.closing) {
        if (masked[index + 1] === ch) {
          index++;
          continue;
        }
        if (active.valid) closed = {
          start: active.start,
          end: index + 1
        };
        active = undefined;
      }
      continue;
    }
    if (ch === '"' || ch === '`' || ch === '[') active = {
      start: index,
      opening: ch,
      closing: ch === '[' ? ']' : ch,
      valid: index === 0 || /[\s.(,=]/u.test(masked[index - 1]!)
    };
  }
  return {
    active,
    closed
  };
}
export function cachedIdentifierFragment(source: string): CachedIdentifierFragment {
  const lineStart = source.lastIndexOf("\n") + 1,
    currentLine = source.slice(lineStart);
  if (/["`[]/u.test(source)) {
    const {
      active
    } = quotes(maskSqlCommentsAndLiterals(source));
    if (active?.valid) {
      if (active.start < lineStart) {
        const prefix = plainIdentifierSuffix(currentLine);
        return {
          prefix,
          replacementLength: prefix.length,
          unsupported: true
        };
      }
      const raw = source.slice(active.start + 1);
      return {
        prefix: raw.split(active.closing + active.closing).join(active.closing),
        replacementLength: raw.length + 1,
        openingQuote: active.opening,
        closingQuote: active.closing
      };
    }
  }
  const prefix = plainIdentifierSuffix(currentLine);
  return {
    prefix,
    replacementLength: prefix.length
  };
}

/** Return the last qualifier atom without running a greedy suffix regex over
 * the preceding SQL, comments or quoted values. */
export function cachedIdentifierQualifier(source: string, masked?: string) {
  const fragment = cachedIdentifierFragment(source);
  if (fragment.unsupported) return undefined;
  const before = source.slice(0, source.length - fragment.replacementLength).trimEnd();
  if (!before.endsWith('.')) return undefined;
  const head = before.slice(0, -1).trimEnd();
  if (/["`\]]$/u.test(head)) {
    const searchable = (masked ?? maskSqlCommentsAndLiterals(source)).slice(0, head.length);
    const {
      closed
    } = quotes(searchable);
    return closed?.end === head.length ? source.slice(closed.start, closed.end) : undefined;
  }
  return plainIdentifierSuffix(head) || undefined;
}
