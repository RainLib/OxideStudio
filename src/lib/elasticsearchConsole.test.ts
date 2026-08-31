import { describe, expect, it } from "vitest";
import {
  elasticsearchConsoleCompletionContext,
  elasticsearchConsoleCompletions,
  elasticsearchJsonKeyReplacementRange,
  elasticsearchMappingFieldCompletions,
  elasticsearchSchemaCompletionsForContext,
  maskElasticsearchConsoleComments,
  parseElasticsearchConsoleRequests,
  shouldOfferElasticsearchCompletions,
} from "./elasticsearchConsole";

function labels(source: string, version?: 6 | 7 | 8 | { major: 6 | 7 | 8; minor: number }) {
  return elasticsearchConsoleCompletions(source, source.length, version).map(
    (item) => item.label,
  );
}

describe("Elasticsearch Console completion contract", () => {
  it("separates HTTP methods, index paths and index operations", () => {
    const methodSource = "ge";
    expect(
      elasticsearchConsoleCompletionContext(methodSource, methodSource.length),
    ).toMatchObject({ area: "method", typed: "ge" });
    expect(labels(methodSource)).toContain("GET");

    const pathSource = "GET /ord";
    const pathContext = elasticsearchConsoleCompletionContext(
      pathSource,
      pathSource.length,
    );
    expect(pathContext).toMatchObject({ area: "path", typed: "/ord" });
    expect(
      elasticsearchSchemaCompletionsForContext(
        [
          { label: "orders", detail: "Elasticsearch index" },
          { label: "users", detail: "Elasticsearch index" },
          { label: "status", detail: "Elasticsearch field in orders" },
        ],
        pathContext,
        "orders",
      ),
    ).toEqual([
      expect.objectContaining({
        label: "orders",
        insertText: "/orders",
        sortText: "000",
      }),
      expect.objectContaining({ label: "users", insertText: "/users" }),
    ]);

    const operationSource = "GET /orders/_se";
    expect(
      elasticsearchConsoleCompletionContext(
        operationSource,
        operationSource.length,
      ),
    ).toMatchObject({
      area: "operation",
      index: "orders",
      typed: "_se",
    });
    expect(labels(operationSource)).toContain("_search");

    const globalLabels = labels("GET /_");
    expect(globalLabels).toEqual(
      expect.arrayContaining([
        "_cluster/stats",
        "_cat/shards",
        "_cat/thread_pool",
      ]),
    );
  });

  it("classifies search, bool, aggregation and mapping-field positions", () => {
    const querySource = 'POST /orders/_search\n{"query":{"ma';
    expect(
      elasticsearchConsoleCompletionContext(querySource, querySource.length),
    ).toMatchObject({ area: "query-clause", typed: "ma" });
    expect(labels(querySource)).toContain("match");

    const boolSource =
      'POST /orders/_search\n{"query":{"bool":{"mu';
    expect(
      elasticsearchConsoleCompletionContext(boolSource, boolSource.length),
    ).toMatchObject({ area: "bool-clause", typed: "mu" });
    expect(labels(boolSource)).toContain("must");

    const aggregationNameSource = 'POST /orders/_search\n{"aggs":{"by_';
    expect(
      elasticsearchConsoleCompletionContext(
        aggregationNameSource,
        aggregationNameSource.length,
      ).area,
    ).toBe("aggregation-name");

    const aggregationTypeSource =
      'POST /orders/_search\n{"aggs":{"by_status":{"te';
    expect(
      elasticsearchConsoleCompletionContext(
        aggregationTypeSource,
        aggregationTypeSource.length,
      ).area,
    ).toBe("aggregation-type");

    const fieldSource =
      'POST /orders/_search\n{"query":{"term":{"sta';
    const fieldContext = elasticsearchConsoleCompletionContext(
      fieldSource,
      fieldSource.length,
    );
    expect(fieldContext).toMatchObject({
      area: "field-name",
      ownerKey: "term",
      typed: "sta",
    });
    expect(
      elasticsearchMappingFieldCompletions(
        [
          { name: "status", dataType: "keyword" },
          { name: "state", dataType: "keyword" },
          { name: "amount", dataType: "double" },
          { name: "STATUS", dataType: "keyword" },
        ],
        fieldContext,
        "orders",
      ),
    ).toEqual([
      expect.objectContaining({ label: "state", insertText: '"state"' }),
      expect.objectContaining({ label: "status", insertText: '"status"' }),
    ]);
  });

  it("gates version-specific Query DSL and document endpoints", () => {
    const querySource = 'POST /orders/_search\n{"query":{"';
    expect(labels(querySource, 6)).toContain("type");
    expect(labels(querySource, 6)).not.toContain("combined_fields");
    expect(labels(querySource, { major: 7, minor: 12 })).not.toContain(
      "combined_fields",
    );
    expect(labels(querySource, { major: 7, minor: 13 })).toContain(
      "combined_fields",
    );
    expect(labels(querySource, 8)).not.toContain("type");

    const bodySource = 'POST /orders/_search\n{"';
    expect(labels(bodySource, { major: 7, minor: 10 })).not.toContain(
      "runtime_mappings",
    );
    expect(labels(bodySource, { major: 7, minor: 11 })).toContain(
      "runtime_mappings",
    );
    expect(labels(bodySource, 7)).not.toContain("knn");
    expect(labels(bodySource, 8)).toContain("knn");

    const documentSource = "GET /orders/";
    expect(labels(documentSource, 6)).toContain("{type}/{id}");
    expect(labels(documentSource, 8)).toContain("_doc/{id}");
  });

  it("parses multiple requests while preserving comment and URL offsets", () => {
    const source = [
      "# inspect orders",
      "GET /orders/_search",
      '{"query":{"match_all":{}}}',
      "",
      "// inspect events",
      "POST /events/_count",
      '{"query":{"match_all":{}}}',
    ].join("\n");
    const requests = parseElasticsearchConsoleRequests(source);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.text).toContain("GET /orders/_search");
    expect(requests[1]?.text).toContain("POST /events/_count");

    const withUrl = 'POST /_search\n{"endpoint":"https://example.test/a//b"}';
    expect(maskElasticsearchConsoleComments(withUrl)).toContain(
      '"https://example.test/a//b"',
    );
  });

  it("continues method and endpoint completion after comments and prior requests", () => {
    const afterComment = "# inspect indices\npo";
    expect(
      elasticsearchConsoleCompletionContext(
        afterComment,
        afterComment.length,
      ),
    ).toMatchObject({ area: "method", typed: "po" });
    expect(labels(afterComment)).toContain("POST");

    const laterRequest = [
      "GET /orders/_search",
      '{"query":{"match_all":{}}}',
      "",
      "de",
    ].join("\n");
    expect(
      elasticsearchConsoleCompletionContext(
        laterRequest,
        laterRequest.length,
      ),
    ).toMatchObject({ area: "method", typed: "de" });
    expect(labels(laterRequest)).toContain("DELETE");

    expect(labels("GET /orders/_co")).toContain("_count");
  });

  it("does not offer JSON keys in scalar value slots", () => {
    const source = 'GET /orders/_search\n{"sort":["fi';
    expect(
      elasticsearchConsoleCompletionContext(source, source.length),
    ).toMatchObject({ area: "value" });
    expect(labels(source)).not.toContain("bool");
    expect(labels(source)).not.toContain("fields");
  });

  it("does not open a second method popup on a blank request body line", () => {
    const bodyStart = "GET /orders/_search\n";
    expect(
      elasticsearchConsoleCompletionContext(bodyStart, bodyStart.length).area,
    ).toBe("body-start");
    expect(shouldOfferElasticsearchCompletions(bodyStart, bodyStart.length)).toBe(
      true,
    );
    expect(labels(bodyStart)).toContain("search body");
  });

  it("replaces the complete auto-closed JSON key without duplicating quotes", () => {
    const source = 'POST /orders/_search\n{\n  "qu"\n}';
    const cursor = source.indexOf('"qu"') + 3;
    const range = elasticsearchJsonKeyReplacementRange(source, cursor);
    const completion = elasticsearchConsoleCompletions(source, cursor).find(
      (item) => item.label === "query",
    );

    expect(range).toEqual({
      startOffset: source.indexOf('"qu"'),
      endOffset: source.indexOf('"qu"') + 4,
      quoted: true,
    });
    const applied = `${source.slice(0, range!.startOffset)}${completion!.insertText}${source.slice(range!.endOffset)}`;
    expect(applied).toContain('"query": {');
    expect(applied).not.toContain('""');
  });

  it("keeps an existing JSON value when completing inside its key", () => {
    const source = 'POST /orders/_search\n{\n  "size": 10\n}';
    const cursor = source.indexOf("size") + 2;
    const context = elasticsearchConsoleCompletionContext(source, cursor);
    const range = elasticsearchJsonKeyReplacementRange(source, cursor)!;
    const completion = elasticsearchConsoleCompletions(source, cursor).find(
      (item) => item.label === "size",
    );

    expect(context.hasKeySeparator).toBe(true);
    expect(completion?.insertText).toBe('"size"');
    const applied = `${source.slice(0, range.startOffset)}${completion!.insertText}${source.slice(range.endOffset)}`;
    expect(applied).toContain('"size": 10');
    expect(applied).not.toContain(": 100: 10");
  });
});
