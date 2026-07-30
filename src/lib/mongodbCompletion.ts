export type MongoDbCompletionArea =
  | "key"
  | "collection"
  | "value"
  | "unknown";

const COLLECTION_VALUE_KEYS = new Set([
  "collection",
  "find",
  "aggregate",
  "count",
  "create",
  "drop",
  "from",
  "to",
  "renameCollection",
]);

function openJsonStringStart(source: string) {
  let open = -1;
  let escaping = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (open >= 0) {
      if (escaping) {
        escaping = false;
      } else if (character === "\\") {
        escaping = true;
      } else if (character === '"') {
        open = -1;
      }
    } else if (character === '"') {
      open = index;
    }
  }

  return open;
}

/**
 * Lightweight editor-side classification used only to decide whether Monaco
 * should open completion automatically. The LSP remains authoritative for the
 * actual candidates and performs the full JSON/MongoDB context analysis.
 */
export function mongodbCompletionArea(
  source: string,
  cursorOffset: number,
): MongoDbCompletionArea {
  const beforeCursor = source.slice(
    0,
    Math.max(0, Math.min(cursorOffset, source.length)),
  );
  const stringStart = openJsonStringStart(beforeCursor);

  if (stringStart >= 0) {
    const beforeString = beforeCursor.slice(0, stringStart).trimEnd();
    const previous = beforeString[beforeString.length - 1];
    if (previous === "{" || previous === "," || previous === "[") {
      return "key";
    }
    if (previous === ":") {
      const key = beforeString
        .slice(0, -1)
        .trimEnd()
        .match(/"([^"\\]+)"\s*$/u)?.[1];
      return key && COLLECTION_VALUE_KEYS.has(key) ? "collection" : "value";
    }
    return "unknown";
  }

  const trimmedBeforeCursor = beforeCursor.trimEnd();
  const previous = trimmedBeforeCursor[trimmedBeforeCursor.length - 1];
  if (previous === "{" || previous === "," || previous === "[") return "key";
  return "unknown";
}

const MONGODB_AUTOMATIC_TRIGGER = /[A-Za-z0-9_$.-]/u;

export function shouldOfferMongoDbCompletions(
  source: string,
  cursorOffset: number,
) {
  const area = mongodbCompletionArea(source, cursorOffset);
  return area === "key" || area === "collection";
}

export function shouldTriggerMongoDbCompletions(
  source: string,
  cursorOffset: number,
  insertedText: string,
) {
  const lastCharacter = insertedText[insertedText.length - 1];
  return Boolean(
    lastCharacter &&
      (lastCharacter === '"' ||
        lastCharacter === "{" ||
        lastCharacter === "," ||
        MONGODB_AUTOMATIC_TRIGGER.test(lastCharacter)) &&
      shouldOfferMongoDbCompletions(source, cursorOffset),
  );
}
