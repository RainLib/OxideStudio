import type { Location, Range, TextEdit } from "../types";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeMarkup(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(normalizeMarkup).filter(Boolean).join("\n\n");
  }
  if (isObject(value)) {
    if (typeof value.language === "string" && typeof value.value === "string") {
      return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
    }
    if (typeof value.value === "string") return value.value;
  }
  return "";
}

export function parseRange(value: unknown): Range | undefined {
  if (!isObject(value) || !isObject(value.start) || !isObject(value.end)) {
    return undefined;
  }

  const startLine = Number(value.start.line);
  const startCharacter = Number(value.start.character);
  const endLine = Number(value.end.line);
  const endCharacter = Number(value.end.character);

  if (
    !Number.isFinite(startLine) ||
    !Number.isFinite(startCharacter) ||
    !Number.isFinite(endLine) ||
    !Number.isFinite(endCharacter)
  ) {
    return undefined;
  }

  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function parseLocation(value: unknown): Location | null {
  if (!isObject(value) || typeof value.uri !== "string") return null;
  const range = parseRange(value.range);
  return range ? { uri: value.uri, range } : null;
}

function parseLocationLink(value: unknown): Location | null {
  if (!isObject(value) || typeof value.targetUri !== "string") return null;
  const range = parseRange(value.targetSelectionRange) || parseRange(value.targetRange);
  return range ? { uri: value.targetUri, range } : null;
}

export function parseLocations(value: unknown): Location[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((item) => parseLocation(item) || parseLocationLink(item))
    .filter((item): item is Location => Boolean(item));
}

export function parseTextEdits(value: unknown): TextEdit[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isObject(item) || typeof item.newText !== "string") return null;
      const range = parseRange(item.range);
      return range ? { range, newText: item.newText } : null;
    })
    .filter((item): item is TextEdit => Boolean(item));
}
