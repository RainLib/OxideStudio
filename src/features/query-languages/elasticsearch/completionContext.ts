import { maskElasticsearchConsoleComments } from "@/features/query-languages/elasticsearch/comments";
import { hasElasticsearchJsonKeySeparator } from "@/features/query-languages/elasticsearch/replacementRange";
import {
  elasticsearchConsoleRequestContext,
  elasticsearchRequestNearOffset,
  lineSpans,
  REQUEST_LINE,
} from "@/features/query-languages/elasticsearch/requests";
import { type ElasticsearchConsoleCompletionContext } from "@/features/query-languages/elasticsearch/types";

function currentLineAtOffset(source: string, offset: number) {
  const boundedOffset = Math.max(0, Math.min(offset, source.length));
  const lineStart = source.lastIndexOf("\n", boundedOffset - 1) + 1;
  const nextNewline = source.indexOf("\n", boundedOffset);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  return {
    lineStart,
    beforeCursor: source.slice(lineStart, boundedOffset),
    text: source.slice(lineStart, lineEnd),
  };
}

type JsonContextFrame = {
  kind: "object" | "array";
  ownerKey?: string;
  lastKey?: string;
};

function scanJsonCompletionContext(source: string) {
  const frames: JsonContextFrame[] = [];
  let previous: string | undefined;
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let stringIsKey = false;
  let lastClosedStringWasKey = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
        lastClosedStringWasKey = stringIsKey;
        if (stringIsKey) {
          const frame = frames[frames.length - 1];
          if (frame?.kind === "object") {
            frame.lastKey = source.slice(stringStart + 1, index);
          }
        }
        previous = '"';
      }
      continue;
    }
    if (/\s/.test(character)) continue;

    if (character === '"') {
      inString = true;
      escaped = false;
      stringStart = index;
      stringIsKey = previous === "{" || previous === ",";
      continue;
    }
    if (character === "{") {
      const parent = frames[frames.length - 1];
      const ownerKey =
        previous === ":"
          ? parent?.lastKey
          : previous === "["
            ? parent?.ownerKey
            : undefined;
      frames.push({ kind: "object", ownerKey });
      previous = character;
      continue;
    }
    if (character === "[") {
      const parent = frames[frames.length - 1];
      frames.push({
        kind: "array",
        ownerKey: previous === ":" ? parent?.lastKey : undefined,
      });
      previous = character;
      continue;
    }
    if (character === "}" || character === "]") {
      frames.pop();
      previous = character;
      continue;
    }
    previous = character;
  }

  const current = frames[frames.length - 1];
  const parent = frames[frames.length - 2];
  const typed = inString
    ? source.slice(stringStart + 1)
    : source.match(/[\w.@*-]+$/u)?.[0] || "";
  return {
    frames,
    current,
    parent,
    previous,
    inString,
    stringIsKey,
    lastClosedStringWasKey,
    typed,
  };
}

const FIELD_OBJECT_KEYS = new Set([
  "match",
  "match_phrase",
  "match_phrase_prefix",
  "term",
  "terms",
  "range",
  "prefix",
  "wildcard",
  "regexp",
  "fuzzy",
  "sort",
]);

const QUERY_ARRAY_KEYS = new Set(["filter", "must", "must_not", "should"]);

export const ELASTICSEARCH_MAPPING_FIELD_VALUE_KEYS = new Set([
  "field",
  "fields",
  "_source",
  "docvalue_fields",
  "stored_fields",
  "path",
  "default_field",
]);

/**
 * JSON permits only quoted object keys, but Console completion deliberately
 * activates while a user is still typing the bare key.  The scanner's
 * `previous` character is then the final letter of that key, so it cannot by
 * itself distinguish a key from a scalar value.  Its preceding non-space
 * token is authoritative for this incomplete editing state.
 */
function isBareElasticsearchJsonKey(bodyBeforeCursor: string, typed: string) {
  if (!/^[A-Za-z_$][\w.$-]*$/u.test(typed)) return false;
  const beforeTyped = bodyBeforeCursor.slice(0, -typed.length).trimEnd();
  return beforeTyped.endsWith("{") || beforeTyped.endsWith(",");
}

export function elasticsearchCompletionExpectsMappingField(
  context: ElasticsearchConsoleCompletionContext,
) {
  return (
    context.area === "field-name" ||
    (context.area === "value" &&
      ELASTICSEARCH_MAPPING_FIELD_VALUE_KEYS.has(context.valueKey || ""))
  );
}

/**
 * Classifies the cursor with Console semantics before any completion source is
 * consulted. This prevents JSON/LSP candidates from leaking into HTTP paths
 * and prevents index candidates from being quoted like JSON strings.
 */
export function elasticsearchConsoleCompletionContext(
  source: string,
  cursorOffset: number,
): ElasticsearchConsoleCompletionContext {
  const boundedOffset = Math.max(0, Math.min(cursorOffset, source.length));
  const line = currentLineAtOffset(source, boundedOffset);
  const beforeCursor = line.beforeCursor.trimStart();
  const requestLine = beforeCursor.match(
    /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(.*)$/i,
  );
  if (requestLine) {
    const method = requestLine[1]!.toUpperCase();
    const typedPath = requestLine[2] || "";
    const pathWithoutQuery = typedPath.split(/[?#]/, 1)[0] || "";
    const normalizedPath = pathWithoutQuery.replace(/^\/+/, "");
    const segments = normalizedPath.split("/");
    const firstSegment = segments[0] || "";
    const hasOperationSegment =
      firstSegment.startsWith("_") || segments.length > 1;
    if (hasOperationSegment) {
      const index = firstSegment.startsWith("_") ? undefined : firstSegment;
      const operation = index ? segments.slice(1).join("/") : normalizedPath;
      return {
        area: "operation",
        typed: operation,
        method,
        index,
        operation,
        ownerKey: index,
      };
    }
    return {
      area: "path",
      typed: typedPath,
      method,
      index: firstSegment || undefined,
    };
  }

  const request = elasticsearchRequestNearOffset(source, boundedOffset);
  const requestHeaderEnd = request
    ? source.indexOf("\n", request.startOffset)
    : -1;
  const cursorIsInRequestBody = Boolean(
    request &&
      requestHeaderEnd >= request.startOffset &&
      boundedOffset > requestHeaderEnd,
  );
  const previousLines = source.slice(0, line.lineStart);
  const hasRequestHeaderBeforeLine = lineSpans(
    maskElasticsearchConsoleComments(previousLines),
  ).some((candidate) => REQUEST_LINE.test(candidate.text));
  const completedBodyBeforeLine = (() => {
    if (!request || requestHeaderEnd < request.startOffset) return false;
    const body = maskElasticsearchConsoleComments(
      source.slice(requestHeaderEnd + 1, line.lineStart),
    ).trim();
    if (!body) return false;
    const scan = scanJsonCompletionContext(body);
    return scan.frames.length === 0 && !scan.inString;
  })();

  // A blank body line after `METHOD /path` belongs to that request. Treating
  // it as a new method line is what previously produced a stray `GET` ghost
  // suggestion below a valid `_search` request.
  if (
    (!beforeCursor || /^[A-Za-z]*$/.test(beforeCursor)) &&
    (!cursorIsInRequestBody ||
      !hasRequestHeaderBeforeLine ||
      completedBodyBeforeLine)
  ) {
    return { area: "method", typed: beforeCursor };
  }
  if (!request) return { area: "unknown", typed: "" };

  const requestBeforeCursor = source.slice(request.startOffset, boundedOffset);
  const firstNewline = requestBeforeCursor.indexOf("\n");
  if (firstNewline === -1) return { area: "unknown", typed: "" };

  const bodyBeforeCursor = maskElasticsearchConsoleComments(
    requestBeforeCursor.slice(firstNewline + 1),
  );
  const requestContext = elasticsearchConsoleRequestContext(
    source,
    boundedOffset,
  );
  const requestPathSegments = requestContext.path
    ?.split(/[?#]/, 1)[0]
    ?.replace(/^\/+/, "")
    .split("/");
  const operation = requestPathSegments?.[0]?.startsWith("_")
    ? requestPathSegments.join("/")
    : requestPathSegments?.slice(1).join("/");
  if (!bodyBeforeCursor.trim()) {
    return {
      area: "body-start",
      typed: "",
      method: requestContext.method,
      index: requestContext.index,
      operation,
      ownerKey: operation,
    };
  }
  const scan = scanJsonCompletionContext(bodyBeforeCursor);

  // Once a complete body is followed by a genuinely empty line, users are
  // starting the next Console request rather than adding another JSON key.
  if (!beforeCursor && scan.frames.length === 0) {
    return { area: "method", typed: "" };
  }
  const currentObject = [...scan.frames]
    .reverse()
    .find((frame) => frame.kind === "object");
  const currentObjectIndex = scan.frames.lastIndexOf(currentObject!);
  const parentObject = scan.frames
    .slice(0, Math.max(0, currentObjectIndex))
    .reverse()
    .find((frame) => frame.kind === "object");
  const ownerKey = currentObject?.ownerKey;
  const keyPosition =
    scan.previous === "{" ||
    scan.previous === "," ||
    (scan.inString && scan.stringIsKey) ||
    (!scan.inString && scan.previous === '"' && scan.lastClosedStringWasKey) ||
    isBareElasticsearchJsonKey(bodyBeforeCursor, scan.typed);
  const typed =
    !scan.inString && scan.previous === '"' && scan.lastClosedStringWasKey
      ? currentObject?.lastKey || scan.typed
      : scan.typed;
  const hasKeySeparator = keyPosition
    ? hasElasticsearchJsonKeySeparator(source, boundedOffset)
    : false;

  if (!keyPosition) {
    return {
      area: "value",
      typed,
      ownerKey,
      valueKey: currentObject?.lastKey,
    };
  }
  if (!ownerKey) {
    return { area: "top-level", typed, hasKeySeparator };
  }
  if (ownerKey === "query" || QUERY_ARRAY_KEYS.has(ownerKey)) {
    return { area: "query-clause", typed, ownerKey, hasKeySeparator };
  }
  if (ownerKey === "bool") {
    return { area: "bool-clause", typed, ownerKey, hasKeySeparator };
  }
  if (ownerKey === "aggs" || ownerKey === "aggregations") {
    return { area: "aggregation-name", typed, ownerKey, hasKeySeparator };
  }
  if (
    parentObject?.ownerKey === "aggs" ||
    parentObject?.ownerKey === "aggregations"
  ) {
    return { area: "aggregation-type", typed, ownerKey, hasKeySeparator };
  }
  if (FIELD_OBJECT_KEYS.has(ownerKey)) {
    return { area: "field-name", typed, ownerKey, hasKeySeparator };
  }
  return { area: "unknown", typed, ownerKey, hasKeySeparator };
}
