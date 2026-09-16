export function parseIdentifierPath(value: string) {
  const result: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (/\s/u.test(value[cursor] || "")) cursor += 1;
    const token = readIdentifier(value, cursor);
    if (!token) break;
    result.push(token.value);
    cursor = token.end;
    while (/\s/u.test(value[cursor] || "")) cursor += 1;
    if (value[cursor] !== ".") break;
    cursor += 1;
  }
  return result;
}

export function readIdentifier(value: string, start: number) {
  let cursor = start;
  while (/\s/u.test(value[cursor] || "")) cursor += 1;
  const quote = value[cursor];
  if (quote === '"' || quote === "`") {
    let result = "";
    for (let index = cursor + 1; index < value.length; index += 1) {
      if (value[index] === quote) {
        if (value[index + 1] === quote) {
          result += quote;
          index += 1;
          continue;
        }
        return { value: result, end: index + 1 };
      }
      result += value[index];
    }
    return null;
  }
  const match = value.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_$-]*/u);
  return match ? { value: match[0], end: cursor + match[0].length } : null;
}

export function unquote(value: string) {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("`") && value.endsWith("`"))
  ) {
    return value
      .slice(1, -1)
      .replace(/\\'/gu, "'")
      .replace(/\\`/gu, "`")
      .replace(/\\\\/gu, "\\");
  }
  return value;
}

export function splitTopLevel(value: string, delimiter: string) {
  const parts: string[] = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") roundDepth += 1;
    if (character === ")") roundDepth = Math.max(0, roundDepth - 1);
    if (character === "[") squareDepth += 1;
    if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (character === delimiter && roundDepth === 0 && squareDepth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function findTopLevel(value: string, needle: string, start = 0) {
  let quote = "";
  for (let index = start; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === needle) return index;
  }
  return -1;
}

export function matchingPair(
  value: string,
  opening: number,
  open: string,
  close: string,
) {
  let depth = 0;
  let quote = "";
  for (let index = opening; index < value.length; index += 1) {
    const character = value[index] || "";
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
