import { QueryLanguage } from "@/features/workspace-tabs/model/types";
import { compileElasticsearchConsoleExecution } from "@/lib/elasticsearchConsole";

export const ELASTICSEARCH_REQUEST_LINE =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/?\S+/i;

export function queryTextForLanguage(
  query: string,
  driver: string,
  language?: QueryLanguage,
  elasticsearchVariables?: Record<string, string>,
) {
  const trimmed = query.trim();
  const isElasticsearch = ["elasticsearch", "elastic"].includes(
    driver.trim().toLowerCase(),
  );
  if (!isElasticsearch) {
    return query;
  }
  if (language !== "elasticsearch-eql") {
    return compileElasticsearchConsoleExecution(query, elasticsearchVariables);
  }
  if (ELASTICSEARCH_REQUEST_LINE.test(trimmed)) return query;

  const body = trimmed.startsWith("{")
    ? trimmed
    : JSON.stringify({ query: trimmed }, null, 2);
  return `POST /_eql/search\n${body}`;
}
