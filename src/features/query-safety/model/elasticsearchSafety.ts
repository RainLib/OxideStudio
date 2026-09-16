import { type AiQuerySafety } from "@/features/query-safety/model/classifyQuerySafety";

export function looksReadOnlyElasticsearchRequest(query: string) {
  return classifyElasticsearchRequestSource(query) === "read";
}

export function looksDestructiveElasticsearchRequest(query: string) {
  return classifyElasticsearchRequestSource(query) === "destructive";
}

type ElasticsearchRequestSafety = AiQuerySafety | null;

const READ_ONLY_ELASTICSEARCH_POST_SEGMENTS = new Set([
  "_search",
  "_count",
  "_sql",
  "_msearch",
  "_field_caps",
  "_terms_enum",
  "_validate",
  "_explain",
  "_rank_eval",
  "_search_shards",
]);

const DESTRUCTIVE_ELASTICSEARCH_SEGMENTS = new Set([
  "_delete_by_query",
  "_close",
  "_forcemerge",
  "_shrink",
  "_split",
]);

function classifyElasticsearchRequestSource(
  query: string,
): ElasticsearchRequestSafety {
  const structuralLines = uncommentedElasticsearchLines(query);
  const firstRequest = parseElasticsearchRequestLine(structuralLines[0] || "");
  if (!firstRequest) return null;

  let highest: AiQuerySafety = "read";
  for (const line of structuralLines) {
    const request = parseElasticsearchRequestLine(line);
    if (!request) continue;
    const safety = classifyElasticsearchRequest(request, query);
    if (safety === "destructive") return safety;
    if (safety === "write") highest = safety;
  }
  return highest;
}

function parseElasticsearchRequestLine(line: string) {
  const match = line
    .trim()
    .match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/iu);
  if (!match?.[1] || !match[2]) return null;
  const path = (match[2].split(/[?#]/u, 1)[0] || "").replace(/\/+$/u, "");
  return {
    method: match[1].toUpperCase(),
    path: path.toLowerCase(),
    segments: path
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.toLowerCase()),
  };
}

function classifyElasticsearchRequest(
  request: NonNullable<ReturnType<typeof parseElasticsearchRequestLine>>,
  fullSource: string,
): AiQuerySafety {
  const { method, path, segments } = request;
  if (
    segments.some((segment) => DESTRUCTIVE_ELASTICSEARCH_SEGMENTS.has(segment))
  ) {
    return "destructive";
  }
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return "read";
  }
  if (method === "POST") {
    if (
      segments.some((segment) =>
        READ_ONLY_ELASTICSEARCH_POST_SEGMENTS.has(segment),
      ) ||
      path.includes("/_eql/search") ||
      path.includes("/_async_search") ||
      path.includes("/_search/scroll")
    ) {
      return "read";
    }
    if (
      (segments.includes("_bulk") && /"delete"\s*:/iu.test(fullSource)) ||
      (segments.includes("_aliases") && /"remove_index"\s*:/iu.test(fullSource))
    ) {
      return "destructive";
    }
    return segments.some((segment) =>
      ["_doc", "_create", "_update", "_bulk"].includes(segment),
    )
      ? "write"
      : "destructive";
  }
  if (method === "DELETE") return "destructive";
  if (method === "PUT" || method === "PATCH") return "write";
  return "destructive";
}

function uncommentedElasticsearchLines(source: string) {
  const lines: string[] = [];
  let inBlockComment = false;
  for (const rawLine of source.split(/\r?\n/u)) {
    let offset = 0;
    while (offset < rawLine.length) {
      if (inBlockComment) {
        const close = rawLine.indexOf("*/", offset);
        if (close < 0) break;
        inBlockComment = false;
        offset = close + 2;
        continue;
      }
      while (/\s/u.test(rawLine[offset] || "")) offset += 1;
      if (offset >= rawLine.length) break;
      if (rawLine.startsWith("/*", offset)) {
        inBlockComment = true;
        offset += 2;
        continue;
      }
      if (rawLine[offset] === "#" || rawLine.startsWith("//", offset)) break;
      lines.push(rawLine.slice(offset));
      break;
    }
  }
  return lines;
}
