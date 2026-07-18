import { describe, expect, it } from "vitest";
import {
  elasticsearchRequestAtOffset,
  parseElasticsearchConsoleRequests,
} from "@/lib/elasticsearchConsole";

const consoleScript = `POST products/_search
{
  "query": { "match_all": {} }
}

GET /products/_mapping

POST products/_search
{"size": 10}`;

describe("Elasticsearch Kibana Console requests", () => {
  it("splits multiple requests with optional leading slashes", () => {
    expect(
      parseElasticsearchConsoleRequests(consoleScript).map(
        (request) => request.text,
      ),
    ).toEqual([
      `POST products/_search
{
  "query": { "match_all": {} }
}`,
      "GET /products/_mapping",
      `POST products/_search
{"size": 10}`,
    ]);
  });

  it("selects the request under the cursor", () => {
    expect(
      elasticsearchRequestAtOffset(
        consoleScript,
        consoleScript.indexOf('"match_all"'),
      )?.text,
    ).toContain("POST products/_search");
    expect(
      elasticsearchRequestAtOffset(
        consoleScript,
        consoleScript.indexOf("/products/_mapping"),
      )?.text,
    ).toBe("GET /products/_mapping");
    expect(
      elasticsearchRequestAtOffset(consoleScript, consoleScript.length)?.text,
    ).toContain('"size": 10');
  });

  it("treats a raw JSON body as one search request", () => {
    const source = `  {
  "query": { "match": { "title": "oxide" } }
}  `;
    expect(parseElasticsearchConsoleRequests(source)).toEqual([
      {
        startOffset: 2,
        endOffset: source.length - 2,
        text: source.slice(2, -2),
      },
    ]);
  });
});
