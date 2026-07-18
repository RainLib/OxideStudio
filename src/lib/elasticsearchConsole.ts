export interface ElasticsearchConsoleRequest {
  startOffset: number;
  endOffset: number;
  text: string;
}

export const ELASTICSEARCH_CONSOLE_LANGUAGE_ID = "elasticsearch-console";

export function registerElasticsearchConsoleLanguage(monaco: any) {
  if (
    monaco.languages
      .getLanguages()
      .some(
        (language: { id: string }) =>
          language.id === ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      )
  ) {
    return;
  }

  monaco.languages.register({
    id: ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    extensions: [".es", ".esdsl"],
    aliases: ["Elasticsearch Console", "Elasticsearch Query DSL"],
  });
  monaco.languages.setMonarchTokensProvider(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      tokenizer: {
        root: [
          [
            /^(\s*)(GET|POST|PUT|PATCH|DELETE|HEAD)(\s+)(\/?\S+)/,
            ["white", "keyword", "white", "string"],
          ],
          [/^\s*#.*$/, "comment"],
          [/\/\/.*$/, "comment"],
          [/[{}[\]]/, "@brackets"],
          [/[,:]/, "delimiter"],
          [/"([^"\\]|\\.)*"(?=\s*:)/, "key"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
          [/\b(?:true|false|null)\b/, "keyword"],
        ],
      },
    },
  );
  monaco.languages.setLanguageConfiguration(
    ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    {
      comments: {
        lineComment: "//",
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: '"', close: '"' },
      ],
    },
  );
}

const REQUEST_LINE =
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+(?:\s+.*)?$/i;

interface LineSpan {
  startOffset: number;
  text: string;
}

function lineSpans(value: string): LineSpan[] {
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

  const requestStarts = lineSpans(source)
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
