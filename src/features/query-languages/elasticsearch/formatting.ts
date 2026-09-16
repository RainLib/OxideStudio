import { parseElasticsearchConsoleRequests } from "@/features/query-languages/elasticsearch/requests";

/**
 * Formats every JSON request body while preserving Kibana Console request
 * lines. Invalid or non-JSON bodies are left untouched for the server to
 * report with its native error details.
 */
export function formatElasticsearchConsole(source: string) {
  const requests = parseElasticsearchConsoleRequests(source);
  if (requests.length === 0) return source;

  return requests
    .map((request) => {
      const newline = request.text.indexOf("\n");
      if (newline === -1) return request.text.trim();
      const header = request.text.slice(0, newline).trim();
      const body = request.text.slice(newline + 1).trim();
      if (!body) return header;
      try {
        return `${header}\n${JSON.stringify(JSON.parse(body), null, 2)}`;
      } catch {
        return request.text.trim();
      }
    })
    .join("\n\n");
}
