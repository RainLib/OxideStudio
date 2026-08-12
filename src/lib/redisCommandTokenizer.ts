export interface RedisArgvToken {
  value: string;
  startColumn: number;
  endColumn: number;
}

export interface RedisArgvResult {
  argv: RedisArgvToken[];
  unclosedQuote: boolean;
  unclosedQuoteStart?: number;
}

function escapedCharacter(value: string): string {
  if (value === "n") return "\n";
  if (value === "r") return "\r";
  if (value === "t") return "\t";
  return value;
}

/** Tokenize one Redis command line using the same quote/escape rules as Rust. */
export function tokenizeRedisLine(line: string): RedisArgvResult {
  let end = line.length;
  while (end > 0 && /\s/.test(line[end - 1]!)) end -= 1;
  while (end > 0 && line[end - 1] === ";") end -= 1;

  const argv: RedisArgvToken[] = [];
  let value = "";
  let startColumn: number | undefined;
  let quote: "'" | '"' | undefined;
  let unclosedQuoteStart: number | undefined;
  let escaping = false;

  const pushToken = (endColumn: number) => {
    if (startColumn !== undefined) argv.push({ value, startColumn, endColumn });
    value = "";
    startColumn = undefined;
  };

  for (let index = 0; index < end; index += 1) {
    const character = line[index]!;
    if (startColumn === undefined) {
      if (/\s/.test(character)) continue;
      startColumn = index + 1;
    }
    if (escaping) {
      value += escapedCharacter(character);
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else value += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      unclosedQuoteStart = index + 1;
      continue;
    }
    if (/\s/.test(character)) {
      pushToken(index + 1);
      continue;
    }
    value += character;
  }

  if (escaping) value += "\\";
  pushToken(end + 1);
  return quote
    ? { argv, unclosedQuote: true, unclosedQuoteStart }
    : { argv, unclosedQuote: false };
}
