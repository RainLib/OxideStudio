import {
  findTopLevel,
  matchingPair,
  splitTopLevel,
  unquote,
} from "@/features/schema-diff/model/dbml-import/lexical";

export function parseSettings(value: string, warnings: Set<string>) {
  const settings = new Map<string, string | true>();
  const opening = value.indexOf("[");
  if (opening < 0) return settings;
  const closing = matchingPair(value, opening, "[", "]");
  if (closing < 0) {
    warnings.add("An unbalanced DBML settings list was ignored.");
    return settings;
  }
  for (const part of splitTopLevel(value.slice(opening + 1, closing), ",")) {
    const separator = findTopLevel(part, ":");
    const key = (separator >= 0 ? part.slice(0, separator) : part)
      .trim()
      .toLowerCase();
    if (!key) continue;
    settings.set(
      key,
      separator >= 0
        ? key === "default"
          ? parseDefaultSetting(part.slice(separator + 1).trim())
          : unquote(part.slice(separator + 1).trim())
        : true,
    );
  }
  return settings;
}

export function parseDefaultSetting(value: string) {
  if (value.startsWith("`") && value.endsWith("`")) return unquote(value);
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return `'${unquote(value).replace(/'/gu, "''")}'`;
  }
  return value;
}

export function settingText(value: string | true | undefined) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function removeTrailingSettings(value: string) {
  const start = findSettingsStart(value);
  return (start >= 0 ? value.slice(0, start) : value).trim();
}

export function findSettingsStart(value: string) {
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
    if (
      character === "[" &&
      (index === 0 || /\s/u.test(value[index - 1] || ""))
    ) {
      return index;
    }
  }
  return -1;
}
