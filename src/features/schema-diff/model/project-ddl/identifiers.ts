import {
  matchingParen,
  splitTopLevel,
} from "@/features/schema-diff/model/project-ddl/lexical";

export function readQualifiedIdentifier(value: string) {
  const part = String.raw`(?:"(?:[^"]|"")*"|\x60(?:[^\x60]|\x60\x60)*\x60|\[(?:[^\]]|\]\])*\]|[A-Za-z_][A-Za-z0-9_$]*)`;
  return value.match(new RegExp(`^${part}(?:\\s*\\.\\s*${part})*`))?.[0] || "";
}

export function normalizeRelationName(value: string, fallbackSchema: string) {
  const segments = value
    .trim()
    .split(".")
    .map(normalizeIdentifier)
    .filter(Boolean);
  if (segments.length === 1) return segments[0];
  if (
    segments.length === 2 &&
    (!fallbackSchema || segments[0] === normalizeIdentifier(fallbackSchema))
  ) {
    return segments[1];
  }
  return null;
}

export function normalizeReferencedRelation(value: string) {
  const segments = value
    .trim()
    .split(".")
    .map(normalizeIdentifier)
    .filter(Boolean);
  if (segments.length === 1 || segments.length === 2) return segments.join(".");
  return null;
}

export function normalizeIdentifier(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const quoted = trimmed.match(
    /^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))$/,
  );
  return (
    quoted?.[1] ||
    quoted?.[2] ||
    quoted?.[3] ||
    quoted?.[4] ||
    ""
  ).trim();
}

export function columnList(value: string) {
  return splitTopLevel(value, ",").map(normalizeIdentifier).filter(Boolean);
}

export function indexColumnList(value: string) {
  return splitTopLevel(value, ",")
    .map((column) => column.trim().replace(/\s+(?:ASC|DESC)\b.*$/i, ""))
    .map((column) => column.replace(/\(\s*\d+\s*\)$/, ""))
    .map(normalizeIdentifier)
    .filter(Boolean);
}

export function parenthesizedContent(value: string) {
  const opening = value.indexOf("(");
  if (opening < 0) return null;
  const close = matchingParen(value, opening);
  if (close < 0) return null;
  return {
    content: value.slice(opening + 1, close),
    trailing: value.slice(close + 1),
  };
}
