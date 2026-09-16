import { maskElasticsearchConsoleComments } from "@/features/query-languages/elasticsearch/comments";
import {
  REQUEST_LINE,
  parseElasticsearchConsoleRequests,
} from "@/features/query-languages/elasticsearch/requests";
import {
  type ElasticsearchConsoleDiagnostic,
  type ElasticsearchConsoleRequest,
} from "@/features/query-languages/elasticsearch/types";

function requestBody(request: ElasticsearchConsoleRequest) {
  const masked = maskElasticsearchConsoleComments(request.text);
  const firstLineEnd = masked.indexOf("\n");
  const firstLine = masked.slice(
    0,
    firstLineEnd === -1 ? masked.length : firstLineEnd,
  );
  const hasRequestLine = REQUEST_LINE.test(firstLine);
  if (!hasRequestLine) {
    return {
      body: masked.trim(),
      bodyStartOffset:
        request.startOffset + (masked.match(/^\s+/)?.[0].length ?? 0),
      requestPath: "/_search",
    };
  }

  const path =
    firstLine.match(
      /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/?\S+)/i,
    )?.[1] || "";
  if (firstLineEnd === -1) {
    const inlineBody = firstLine
      .replace(/^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+\s*/i, "")
      .trim();
    return {
      body: inlineBody,
      bodyStartOffset:
        request.startOffset + firstLine.length - inlineBody.length,
      requestPath: path,
    };
  }

  const rawBody = masked.slice(firstLineEnd + 1);
  const leadingWhitespace = rawBody.match(/^\s+/)?.[0].length ?? 0;
  return {
    body: rawBody.trim(),
    bodyStartOffset: request.startOffset + firstLineEnd + 1 + leadingWhitespace,
    requestPath: path,
  };
}

function jsonErrorOffset(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/position\s+(\d+)/i);
  return {
    message: message.replace(/^JSON\.parse:\s*/i, ""),
    offset: match ? Number(match[1]) : 0,
  };
}

function validationBody(body: string) {
  return body
    .replace(/"""\s*\$\{[\w.-]+\}\s*"""/g, '"variable"')
    .replace(/\$\{[\w.-]+\}/g, "null");
}

function isNdjsonEndpoint(path: string) {
  const pathname = path.split(/[?#]/, 1)[0]?.toLowerCase() || "";
  return /(?:^|\/)_(?:bulk|msearch|msearch\/template)$/.test(pathname);
}

/**
 * Produces local, offset-aware diagnostics before a request reaches the
 * server. API-semantic errors still come from Elasticsearch.
 */
export function validateElasticsearchConsole(
  source: string,
): ElasticsearchConsoleDiagnostic[] {
  if (!source.trim()) return [];
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) {
    return [
      {
        message:
          "Start an Elasticsearch request with GET, POST, PUT, PATCH, DELETE, or HEAD.",
        startOffset: 0,
        endOffset: Math.max(1, source.length),
        severity: "error",
      },
    ];
  }

  const diagnostics: ElasticsearchConsoleDiagnostic[] = [];
  const masked = maskElasticsearchConsoleComments(source);
  const firstRequest = requests[0]!;
  const prefix = masked.slice(0, firstRequest.startOffset).trim();
  if (prefix) {
    const startOffset = masked.indexOf(prefix);
    diagnostics.push({
      message: "Unexpected content before the first Elasticsearch request.",
      startOffset,
      endOffset: startOffset + prefix.length,
      severity: "error",
    });
  }

  requests.forEach((request) => {
    const { body, bodyStartOffset, requestPath } = requestBody(request);
    const pathOffset = request.text.indexOf(requestPath);
    if (requestPath.includes("://")) {
      diagnostics.push({
        message:
          "Use a relative Elasticsearch API path; the configured data source supplies the server address.",
        startOffset: request.startOffset + Math.max(0, pathOffset),
        endOffset:
          request.startOffset + Math.max(0, pathOffset) + requestPath.length,
        severity: "error",
      });
    }
    if (/["']/.test(requestPath)) {
      diagnostics.push({
        message:
          "Do not quote an Elasticsearch request path or index name. Use POST /index/_search.",
        startOffset: request.startOffset + Math.max(0, pathOffset),
        endOffset:
          request.startOffset + Math.max(0, pathOffset) + requestPath.length,
        severity: "error",
      });
    } else if (requestPath && !requestPath.startsWith("/")) {
      diagnostics.push({
        message:
          'Console request paths should start with "/", for example POST /index/_search.',
        startOffset: request.startOffset + Math.max(0, pathOffset),
        endOffset:
          request.startOffset + Math.max(0, pathOffset) + requestPath.length,
        severity: "warning",
      });
    }
    if (!body) return;

    if (isNdjsonEndpoint(requestPath)) {
      let lineOffset = 0;
      body.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          lineOffset += line.length + 1;
          return;
        }
        try {
          JSON.parse(validationBody(trimmed));
        } catch (error) {
          const detail = jsonErrorOffset(error);
          diagnostics.push({
            message: `Invalid NDJSON line: ${detail.message}`,
            startOffset: bodyStartOffset + lineOffset + detail.offset,
            endOffset: Math.min(
              source.length,
              bodyStartOffset + lineOffset + Math.max(1, line.length),
            ),
            severity: "error",
          });
        }
        lineOffset += line.length + 1;
      });
      return;
    }

    try {
      JSON.parse(validationBody(body));
    } catch (error) {
      const detail = jsonErrorOffset(error);
      diagnostics.push({
        message: `Invalid JSON request body: ${detail.message}`,
        startOffset: Math.min(source.length, bodyStartOffset + detail.offset),
        endOffset: Math.min(source.length, bodyStartOffset + detail.offset + 1),
        severity: "error",
      });
    }
  });

  return diagnostics;
}
