export type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
};

export function slashCommandTokenAtCaret(
  value: string,
  selectionStart: number | null,
): SlashCommandToken | null {
  const caret = Math.max(
    0,
    Math.min(selectionStart ?? value.length, value.length),
  );
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)(\/[^\s/]*)$/u.exec(beforeCaret);
  if (!match) return null;
  const rawToken = match[1];
  if (!rawToken) return null;
  const start = caret - rawToken.length;
  let end = caret;
  while (end < value.length && !/\s/u.test(value[end] ?? "")) end += 1;
  return {
    start,
    end,
    query: rawToken.slice(1).toLowerCase(),
  };
}

export function sameSlashCommandToken(
  left: SlashCommandToken | null,
  right: SlashCommandToken | null,
) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.start === right.start &&
      left.end === right.end &&
      left.query === right.query)
  );
}

export function commandTokenKey(
  value: string,
  token: SlashCommandToken | null,
) {
  return token
    ? `${token.start}:${token.end}:${token.query}:${value.slice(token.start, token.end)}`
    : null;
}
