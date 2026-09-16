import { maskElasticsearchConsoleComments } from "@/features/query-languages/elasticsearch/comments";
import {
  type ElasticsearchConsoleRequest,
  type ElasticsearchConsoleRequestContext,
} from "@/features/query-languages/elasticsearch/types";

export const REQUEST_LINE =
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+(?:\s+.*)?$/i;

interface LineSpan {
  startOffset: number;
  text: string;
}

export function lineSpans(value: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let startOffset = 0;

  for (const line of value.split("\n")) {
    lines.push({ startOffset, text: line });
    startOffset += line.length + 1;
  }

  return lines;
}

function trimRequestSpan(
  source: string,
  startOffset: number,
  endOffset: number,
): ElasticsearchConsoleRequest | null {
  const raw = source.slice(startOffset, endOffset);
  const trailingWhitespace = raw.match(/\s+$/)?.[0].length ?? 0;
  const normalizedEnd = Math.max(startOffset, endOffset - trailingWhitespace);
  const text = source.slice(startOffset, normalizedEnd);
  if (!text.trim()) return null;

  return {
    startOffset,
    endOffset: normalizedEnd,
    text,
  };
}

/**
 * Splits Kibana Console-style Elasticsearch requests without parsing their
 * JSON bodies. A request starts at a standalone `METHOD path` line and ends
 * immediately before the next request line.
 */
export function parseElasticsearchConsoleRequests(
  source: string,
): ElasticsearchConsoleRequest[] {
  if (!source.trim()) return [];

  const requestStarts = lineSpans(maskElasticsearchConsoleComments(source))
    .filter((line) => REQUEST_LINE.test(line.text))
    .map((line) => line.startOffset);

  if (requestStarts.length === 0) {
    const leadingWhitespace = source.match(/^\s+/)?.[0].length ?? 0;
    const request = trimRequestSpan(source, leadingWhitespace, source.length);
    return request ? [request] : [];
  }

  return requestStarts.flatMap((startOffset, index) => {
    const endOffset = requestStarts[index + 1] ?? source.length;
    const request = trimRequestSpan(source, startOffset, endOffset);
    return request ? [request] : [];
  });
}

/**
 * Returns the request under the cursor. Whitespace between two requests stays
 * associated with the preceding request, matching Kibana Console behavior.
 */
export function elasticsearchRequestAtOffset(
  source: string,
  cursorOffset: number,
): ElasticsearchConsoleRequest | null {
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) return null;

  const boundedOffset = Math.max(0, Math.min(cursorOffset, source.length));
  return (
    requests.find(
      (request, index) =>
        boundedOffset >= request.startOffset &&
        (boundedOffset <= request.endOffset ||
          (index + 1 < requests.length &&
            boundedOffset < requests[index + 1]!.startOffset)),
    ) ??
    (boundedOffset < requests[0]!.startOffset
      ? requests[0]!
      : requests[requests.length - 1]!)
  );
}

/**
 * Finds the request around the cursor without tokenizing every request in the
 * document. Completion and ghost-text providers run on every key stroke, so a
 * full Console parse here makes large scratch files block the WebView.
 *
 * The public `elasticsearchRequestAtOffset` intentionally keeps its exhaustive
 * behaviour for execution/selection. This local variant is only used by
 * cursor-local editor assistance.
 */
export function elasticsearchRequestNearOffset(
  source: string,
  cursorOffset: number,
): ElasticsearchConsoleRequest | null {
  if (!source.trim()) return null;

  const boundedOffset = Math.max(0, Math.min(cursorOffset, source.length));
  let lineStart = source.lastIndexOf("\n", Math.max(0, boundedOffset - 1)) + 1;
  let requestStart = -1;

  while (lineStart >= 0) {
    const lineEnd = source.indexOf("\n", lineStart);
    const effectiveLineEnd = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(lineStart, effectiveLineEnd).replace(/\r$/, "");
    if (REQUEST_LINE.test(line)) {
      const lastBlockOpen = source.lastIndexOf("/*", lineStart);
      const lastBlockClose = source.lastIndexOf("*/", lineStart);
      if (lastBlockOpen <= lastBlockClose) {
        requestStart = lineStart;
        break;
      }
    }
    if (lineStart === 0) break;
    lineStart = source.lastIndexOf("\n", Math.max(0, lineStart - 2)) + 1;
  }

  if (requestStart === -1) {
    const leadingWhitespace = source.match(/^\s+/)?.[0].length ?? 0;
    return trimRequestSpan(source, leadingWhitespace, source.length);
  }

  let requestEnd = source.length;
  let nextLineStart = source.indexOf("\n", requestStart);
  nextLineStart = nextLineStart === -1 ? source.length : nextLineStart + 1;
  while (nextLineStart < source.length) {
    const lineEnd = source.indexOf("\n", nextLineStart);
    const effectiveLineEnd = lineEnd === -1 ? source.length : lineEnd;
    const line = source
      .slice(nextLineStart, effectiveLineEnd)
      .replace(/\r$/, "");
    if (REQUEST_LINE.test(line)) {
      const lastBlockOpen = source.lastIndexOf("/*", nextLineStart);
      const lastBlockClose = source.lastIndexOf("*/", nextLineStart);
      if (lastBlockOpen <= lastBlockClose) {
        requestEnd = nextLineStart;
        break;
      }
    }
    nextLineStart = lineEnd === -1 ? source.length : lineEnd + 1;
  }

  return trimRequestSpan(source, requestStart, requestEnd);
}

export function elasticsearchConsoleRequestContext(
  source: string,
  cursorOffset: number,
  preferredIndex?: string,
): ElasticsearchConsoleRequestContext {
  const request = elasticsearchRequestNearOffset(source, cursorOffset);
  if (!request) return { request: "", index: preferredIndex };
  const requestLine = request.text.split("\n", 1)[0]?.trim() || "";
  const match = requestLine.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)/i);
  const path = match?.[2]?.replace(/["']/g, "");
  const firstPathSegment = path
    ?.replace(/^\/+/, "")
    .split(/[/?#]/, 1)[0]
    ?.trim();
  const explicitIndex =
    firstPathSegment &&
    !firstPathSegment.startsWith("_") &&
    !/[,*${}]/.test(firstPathSegment)
      ? firstPathSegment
      : undefined;
  return {
    request: request.text,
    startOffset: request.startOffset,
    endOffset: request.endOffset,
    method: match?.[1]?.toUpperCase(),
    path,
    index: explicitIndex || preferredIndex,
  };
}

/**
 * Expands an editor selection to complete Console requests. Kibana executes
 * selected requests sequentially; sending a partial JSON fragment produces a
 * confusing server error and is never useful for Console semantics.
 */
export function elasticsearchRequestsForSelection(
  source: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const start = Math.max(
    0,
    Math.min(selectionStart, selectionEnd, source.length),
  );
  const end = Math.max(
    0,
    Math.min(Math.max(selectionStart, selectionEnd), source.length),
  );
  if (start === end) {
    const request = elasticsearchRequestAtOffset(source, start);
    return request ? [request] : [];
  }

  return parseElasticsearchConsoleRequests(source).filter(
    (request) => request.startOffset < end && request.endOffset > start,
  );
}

export function elasticsearchRequestNavigationOffset(
  source: string,
  cursorOffset: number,
  direction: "previous" | "next",
) {
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) return null;
  const current = elasticsearchRequestAtOffset(source, cursorOffset);
  const currentIndex = current
    ? requests.findIndex(
        (request) =>
          request.startOffset === current.startOffset &&
          request.endOffset === current.endOffset,
      )
    : -1;

  if (direction === "next") {
    return requests[Math.min(requests.length - 1, currentIndex + 1)]!
      .startOffset;
  }
  return requests[Math.max(0, currentIndex - 1)]!.startOffset;
}
