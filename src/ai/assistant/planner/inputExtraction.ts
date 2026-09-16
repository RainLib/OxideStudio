export function parseSelectedRecordArray(
  text: string,
): Array<Record<string, unknown>> | null {
  const value = parseSelectedJsonValue(text);
  if (Array.isArray(value) && value.every(isPlainRecord)) {
    return value;
  }
  if (isPlainRecord(value)) {
    return [value];
  }
  return null;
}

export function parseSelectedRecord(text: string): Record<string, unknown> | null {
  const value = parseSelectedJsonValue(text);
  return isPlainRecord(value) ? value : null;
}

export function parseSelectedJsonValue(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function recordField(
  value: Record<string, unknown> | null,
  field: string,
): Record<string, unknown> | null {
  const fieldValue = value?.[field];
  return isPlainRecord(fieldValue) ? fieldValue : null;
}

export function booleanField(
  value: Record<string, unknown> | null,
  field: string,
): boolean | null {
  const fieldValue = value?.[field];
  return typeof fieldValue === "boolean" ? fieldValue : null;
}

export function inferMongoUpdateDocument(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!value) return null;
  const updateKeys = Object.keys(value).filter((key) => key.startsWith("$"));
  if (updateKeys.length > 0) {
    return value;
  }

  const ignoredFields = new Set(["filter", "many", "upsert"]);
  const setFields = Object.fromEntries(
    Object.entries(value).filter(([key]) => !ignoredFields.has(key)),
  );
  return Object.keys(setFields).length > 0 ? { $set: setFields } : null;
}

export function extractTargetName(message: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const isAsciiLabel = /^[a-z0-9_-]+$/i.test(label);
    const match = message.match(
      new RegExp(
        isAsciiLabel
          ? `\\b${escaped}\\b\\s+(?:named\\s+)?["'\`]?([\\w.:-]+)`
          : `${escaped}\\s*(?:名为|叫|named\\s+)?["'\`]?([\\w.:-]+)`,
        "i",
      ),
    );
    const candidate = match?.[1]?.replace(/[,.，。;；:：]+$/, "");
    if (candidate && !TARGET_NAME_STOP_WORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

const TARGET_NAME_STOP_WORDS = new Set([
  "active",
  "current",
  "selected",
  "this",
  "that",
  "limit",
  "where",
  "with",
  "by",
]);

export function extractLimit(message: string, fallback = 50) {
  const match =
    message.match(/\blimit\s+(\d{1,4})\b/i) ||
    message.match(/\btop\s+(\d{1,4})\b/i) ||
    message.match(/前\s*(\d{1,4})\s*(?:条|个)?/);
  const value = match?.[1] ? Number.parseInt(match[1], 10) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(value, 200));
}

export function extractInlineJsonObject(
  message: string,
): Record<string, unknown> | null {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const value = JSON.parse(message.slice(start, end + 1));
    return isPlainRecord(value) ? value : null;
  } catch {
    return null;
  }
}
