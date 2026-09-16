import { elasticsearchConsoleCompletionContext } from "@/features/query-languages/elasticsearch/completionContext";
import { elasticsearchConsoleCompletionsForContext } from "@/features/query-languages/elasticsearch/completions";
import { HTTP_METHODS } from "@/features/query-languages/elasticsearch/languagePolicy";
import { type ElasticsearchVersionInput } from "@/features/query-languages/elasticsearch/types";

function plainElasticsearchSnippet(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "$" || value[index + 1] !== "{") {
      if (value[index] === "$" && /\d/.test(value[index + 1] || "")) {
        while (/\d/.test(value[index + 1] || "")) index += 1;
      } else {
        output += value[index];
      }
      continue;
    }

    let cursor = index + 2;
    while (/\d/.test(value[cursor] || "")) cursor += 1;
    if (value[cursor] === "}") {
      index = cursor;
      continue;
    }
    if (value[cursor] !== ":") {
      output += value[index];
      continue;
    }

    const defaultStart = cursor + 1;
    let depth = 1;
    cursor = defaultStart;
    for (; cursor < value.length; cursor += 1) {
      if (value[cursor] === "{") depth += 1;
      if (value[cursor] === "}") depth -= 1;
      if (depth === 0) break;
    }
    output += value.slice(defaultStart, cursor);
    index = cursor;
  }
  return output;
}

/** Deterministic, syntax-safe ghost text used by Smart Tab in Console tabs. */
export function elasticsearchConsoleInlineSuggestion(
  source: string,
  cursorOffset: number,
  preferredIndex?: string,
  version?: ElasticsearchVersionInput,
) {
  const context = elasticsearchConsoleCompletionContext(source, cursorOffset);
  if (context.area === "method") {
    const method = HTTP_METHODS.find((item) =>
      item.toLowerCase().startsWith(context.typed.toLowerCase()),
    );
    return method ? `${method.slice(context.typed.length)} ` : "";
  }

  if (context.area === "path") {
    if (/["']/.test(context.typed)) return "";
    const canonicalIndex = preferredIndex?.trim().replace(/^\/+|\/+$/g, "");
    const target = canonicalIndex
      ? `/${canonicalIndex}/_search\n{\n  \"query\": {\n    \"match_all\": {}\n  }\n}`
      : '/_search\n{\n  "query": {\n    "match_all": {}\n  }\n}';
    if (!context.typed) return target;
    if (target.startsWith(context.typed)) {
      return target.slice(context.typed.length);
    }
    return "";
  }

  if (context.area === "operation") {
    const candidate = elasticsearchConsoleCompletionsForContext(
      source,
      cursorOffset,
      context,
      version,
    )[0];
    if (!candidate) return "";
    const insertion = plainElasticsearchSnippet(candidate.insertText);
    return insertion.startsWith(context.typed)
      ? insertion.slice(context.typed.length)
      : "";
  }

  const completions = elasticsearchConsoleCompletionsForContext(
    source,
    cursorOffset,
    context,
    version,
  );
  // Inline ghost text is relative to the existing cursor position. Monaco
  // renders it after the active line rather than replacing a key range, so
  // adding the current line indent here would duplicate that indentation.
  const candidate = completions.find((item) =>
    item.label.toLowerCase().startsWith(context.typed.toLowerCase()),
  );
  if (!candidate) return "";
  const insertion = plainElasticsearchSnippet(candidate.insertText);
  const beforeCursor = source.slice(0, cursorOffset);
  const quotedClosed = context.typed ? `"${context.typed}"` : "";
  const quotedOpen = context.typed ? `"${context.typed}` : "";
  const fragment =
    quotedClosed && beforeCursor.endsWith(quotedClosed)
      ? quotedClosed
      : quotedOpen && beforeCursor.endsWith(quotedOpen)
        ? quotedOpen
        : context.typed;
  return insertion.startsWith(fragment) ? insertion.slice(fragment.length) : "";
}
