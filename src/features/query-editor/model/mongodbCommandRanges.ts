export type MongoDbCommandRange = {
  from: number;
  to: number;
  text: string;
};

function skipWhitespace(source: string, offset: number) {
  let cursor = offset;
  while (cursor < source.length && /\s/u.test(source[cursor] || "")) cursor += 1;
  return cursor;
}

function scanJsonValueEnd(source: string, offset: number) {
  const start = skipWhitespace(source, offset);
  const first = source[start];
  if (first !== "{" && first !== "[") return null;

  const stack = [first];
  let inString = false;
  let escaped = false;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor] || "";
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;

    const expected = character === "}" ? "{" : "[";
    if (stack.pop() !== expected) return null;
    if (stack.length === 0) return cursor + 1;
  }
  return null;
}

function validatedObjectRange(source: string, from: number, to: number) {
  const text = source.slice(from, to);
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { from, to, text }
      : null;
  } catch {
    return null;
  }
}

function arrayCommandRanges(source: string, from: number, to: number) {
  const ranges: MongoDbCommandRange[] = [];
  let cursor = skipWhitespace(source, from + 1);
  while (cursor < to - 1) {
    if (source[cursor] === "]") break;
    const end = scanJsonValueEnd(source, cursor);
    if (end === null || end > to - 1) return [];
    const range = validatedObjectRange(source, cursor, end);
    if (!range) return [];
    ranges.push(range);
    cursor = skipWhitespace(source, end);
    if (source[cursor] === ",") {
      cursor = skipWhitespace(source, cursor + 1);
      continue;
    }
    if (source[cursor] !== "]") return [];
    break;
  }
  return ranges;
}

function trimmedCommandRange(source: string, from: number, to: number) {
  let start = from;
  let end = to;
  while (start < end && /\s/u.test(source[start] || "")) start += 1;
  while (end > start && /\s/u.test(source[end - 1] || "")) end -= 1;
  if (start >= end) return null;
  return { from: start, to: end, text: source.slice(start, end) };
}

function mongoShellCommandRanges(source: string): MongoDbCommandRange[] {
  const ranges: MongoDbCommandRange[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor] || "";
    const next = source[cursor + 1] || "";
    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        cursor += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if ((character === "/" && next === "/") || (character === "-" && next === "-")) {
      lineComment = true;
      cursor += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      cursor += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth < 0) return [];
    } else if (character === ";" && depth === 0) {
      const range = trimmedCommandRange(source, start, cursor);
      if (range) ranges.push(range);
      start = cursor + 1;
    }
  }
  if (quote || blockComment || depth !== 0) return [];
  const tail = trimmedCommandRange(source, start, source.length);
  if (tail) ranges.push(tail);
  return ranges.every((range) => /^(?:(?:\/\/|--)[^\r\n]*(?:\r?\n)|\/\*[\s\S]*?\*\/\s*)*db\./iu.test(range.text))
    ? ranges
    : [];
}

/**
 * Split the strict JSON command shapes accepted by the native MongoDB driver.
 * A document may contain one object, a top-level array of objects, or several
 * whitespace-separated objects. The latter matches the editor workflow while
 * remaining valid for the backend's streaming JSON parser.
 */
export function mongodbCommandRanges(source: string): MongoDbCommandRange[] {
  const first = source.slice(skipWhitespace(source, 0), skipWhitespace(source, 0) + 1);
  if (first && first !== "{" && first !== "[") {
    return mongoShellCommandRanges(source);
  }
  const ranges: MongoDbCommandRange[] = [];
  let cursor = skipWhitespace(source, 0);
  while (cursor < source.length) {
    const end = scanJsonValueEnd(source, cursor);
    if (end === null) return [];

    if (source[cursor] === "[") {
      // A command array is only unwrapped when it is the sole top-level value.
      if (ranges.length > 0 || skipWhitespace(source, end) < source.length) {
        return [];
      }
      return arrayCommandRanges(source, cursor, end);
    }

    const range = validatedObjectRange(source, cursor, end);
    if (!range) return [];
    ranges.push(range);
    cursor = skipWhitespace(source, end);
  }
  return ranges;
}

function cursorLineBounds(source: string, cursorOffset: number) {
  const from = source.lastIndexOf("\n", Math.max(0, cursorOffset - 1)) + 1;
  const newline = source.indexOf("\n", cursorOffset);
  return { from, to: newline < 0 ? source.length : newline };
}

export function mongodbCommandRangeAtCursor(
  source: string,
  cursorOffset: number,
) {
  const cursor = Math.max(0, Math.min(cursorOffset, source.length));
  const line = cursorLineBounds(source, cursor);
  if (!source.slice(line.from, line.to).trim()) return null;

  for (const range of mongodbCommandRanges(source)) {
    if (cursor >= range.from && cursor <= range.to) return range;
    if (
      cursor < range.from &&
      range.from <= line.to &&
      source.slice(cursor, range.from).trim() === ""
    ) {
      return range;
    }
    if (
      cursor > range.to &&
      range.to >= line.from &&
      source.slice(range.to, cursor).trim() === ""
    ) {
      return range;
    }
  }
  return null;
}
