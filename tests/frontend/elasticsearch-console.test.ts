import { describe, expect, it } from "vitest";
import {
  compileElasticsearchConsoleExecution,
  elasticsearchConsoleVariableNames,
  elasticsearchConsoleCompletions,
  elasticsearchConsoleCompletionContext,
  elasticsearchConsoleInlineSuggestion,
  elasticsearchMappingFieldCompletions,
  elasticsearchConsoleRequestContext,
  elasticsearchSchemaCompletionsForContext,
  elasticsearchRequestAtOffset,
  elasticsearchRequestNavigationOffset,
  elasticsearchRequestsForSelection,
  formatElasticsearchConsole,
  prepareElasticsearchConsoleExecution,
  parseElasticsearchConsoleRequests,
  registerElasticsearchConsoleLanguage,
  shouldOfferElasticsearchCompletions,
  shouldTriggerElasticsearchCompletions,
  validateElasticsearchConsole,
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

  it("suggests request methods, endpoints, and search body properties", () => {
    expect(
      elasticsearchConsoleCompletions("PO", 2).map((item) => item.label),
    ).toContain("POST");
    expect(
      elasticsearchConsoleCompletions("POST products/", 14).map(
        (item) => item.label,
      ),
    ).toContain("_search");
    expect(
      elasticsearchConsoleCompletions("POST ", 5)[0]?.insertText,
    ).toMatch(/^\//);

    const body = `POST products/_search
{
  "`;
    expect(
      elasticsearchConsoleCompletions(body, body.length).map(
        (item) => item.label,
      ),
    ).toEqual(expect.arrayContaining(["query", "aggs", "_source", "sort"]));
  });

  it("separates HTTP method, index, operation, and request-body completion", () => {
    expect(
      elasticsearchConsoleCompletions("", 0).map((item) => item.label),
    ).toEqual(expect.arrayContaining(["GET", "POST", "PUT", "DELETE"]));

    const operationSource = "POST /products/_";
    expect(
      elasticsearchConsoleCompletionContext(
        operationSource,
        operationSource.length,
      ),
    ).toMatchObject({
      area: "operation",
      typed: "_",
      ownerKey: "products",
    });
    expect(
      elasticsearchConsoleCompletions(
        operationSource,
        operationSource.length,
      ).map((item) => item.label),
    ).toEqual(
      expect.arrayContaining([
        "_search",
        "_count",
        "_msearch",
        "_bulk",
        "_update_by_query",
        "_delete_by_query",
      ]),
    );
    const getOperations = elasticsearchConsoleCompletions(
      "GET /products/_",
      "GET /products/_".length,
    ).map((item) => item.label);
    expect(getOperations).toEqual(
      expect.arrayContaining(["_search", "_mapping", "_stats", "_field_caps"]),
    );
    expect(getOperations).not.toContain("_bulk");
    expect(getOperations).not.toContain("_update_by_query");
    expect(
      elasticsearchConsoleCompletions(
        "POST /_",
        "POST /_".length,
      ).map((item) => item.label),
    ).toEqual(
      expect.arrayContaining(["_search", "_msearch", "_bulk", "_reindex"]),
    );

    const rootPostOperations = elasticsearchConsoleCompletions(
      "POST /",
      "POST /".length,
    ).map((item) => item.label);
    expect(rootPostOperations).toEqual(
      expect.arrayContaining([
        "/{index}/_search",
        "/_search",
        "/_msearch",
        "/_bulk",
        "/_reindex",
      ]),
    );
    expect(rootPostOperations).not.toContain("/_cluster/health");

    const indexOperations = elasticsearchConsoleCompletions(
      "POST /products/",
      "POST /products/".length,
    ).map((item) => item.label);
    expect(indexOperations).toEqual(
      expect.arrayContaining([
        "_search",
        "_count",
        "_bulk",
        "_update_by_query",
        "_delete_by_query",
      ]),
    );

    const bodyStart = "POST /products/_search\n";
    expect(
      elasticsearchConsoleCompletionContext(bodyStart, bodyStart.length),
    ).toMatchObject({ area: "body-start", ownerKey: "_search" });
    expect(
      elasticsearchConsoleCompletions(bodyStart, bodyStart.length).map(
        (item) => item.label,
      ),
    ).toContain("search body");
    expect(
      elasticsearchConsoleInlineSuggestion(bodyStart, bodyStart.length),
    ).toContain('"query"');
    expect(
      elasticsearchConsoleInlineSuggestion(bodyStart, bodyStart.length),
    ).not.toContain("GET");
  });

  it("requests the suggestion widget while methods, operations, and DSL keys are typed", () => {
    expect(shouldTriggerElasticsearchCompletions("P", 1, "P")).toBe(true);
    expect(
      shouldTriggerElasticsearchCompletions(
        "POST /anocs_test/",
        "POST /anocs_test/".length,
        "/",
      ),
    ).toBe(true);

    const queryKey = 'POST /anocs_test/_search\n{\n  "query": {\n    ""';
    expect(shouldOfferElasticsearchCompletions(queryKey, queryKey.length - 1))
      .toBe(true);
    expect(
      shouldTriggerElasticsearchCompletions(
        queryKey,
        queryKey.length - 1,
        '"',
      ),
    ).toBe(true);

    const fieldKey =
      'POST /anocs_test/_search\n{\n  "query": {\n    "term": {\n      "g';
    expect(
      shouldTriggerElasticsearchCompletions(
        fieldKey,
        fieldKey.length,
        "g",
      ),
    ).toBe(true);
  });

  it("registers Monaco trigger characters and operation suggestions", () => {
    let completionProvider: any;
    const disposable = { dispose: () => undefined };
    const monaco: any = {
      languages: {
        getLanguages: () => [],
        register: () => undefined,
        setMonarchTokensProvider: () => disposable,
        setLanguageConfiguration: () => disposable,
        registerCompletionItemProvider: (_language: string, provider: any) => {
          completionProvider = provider;
          return disposable;
        },
        registerDocumentFormattingEditProvider: () => disposable,
        registerCodeActionProvider: () => disposable,
        CompletionItemKind: { Keyword: 1, Property: 2, Snippet: 3 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      },
    };

    registerElasticsearchConsoleLanguage(monaco);
    expect(completionProvider.triggerCharacters).toEqual(
      expect.arrayContaining(["P", "o", "_", "/", '"']),
    );

    const source = "POST /anocs_test/";
    const result = completionProvider.provideCompletionItems(
      {
        getOffsetAt: () => source.length,
        getWordUntilPosition: (position: any) => ({
          startColumn: position.column,
          endColumn: position.column,
        }),
        getLineContent: () => source,
        getValue: () => source,
      },
      { lineNumber: 1, column: source.length + 1 },
    );
    expect(result.incomplete).toBe(true);
    expect(result.suggestions.map((item: any) => item.label)).toEqual(
      expect.arrayContaining(["_search", "_count", "_bulk"]),
    );
  });

  it("continues with Query DSL inside an auto-closed search body", () => {
    const source = 'POST /products/_search\n{"query": {';
    expect(
      elasticsearchConsoleCompletionContext(source, source.length),
    ).toMatchObject({ area: "query-clause", ownerKey: "query" });
    expect(
      elasticsearchConsoleCompletions(source, source.length).map(
        (item) => item.label,
      ),
    ).toEqual(expect.arrayContaining(["match_all", "match", "term", "bool"]));
    expect(
      elasticsearchConsoleInlineSuggestion(source, source.length),
    ).toBe('"match_all": {}');
  });

  it("keeps HTTP paths, JSON properties, and mapping fields in separate contexts", () => {
    expect(
      elasticsearchConsoleCompletionContext("POST /ano", 9),
    ).toMatchObject({ area: "path", typed: "/ano" });
    expect(
      elasticsearchConsoleCompletionContext(
        'POST /anocs_new/_search\n{\n  "_sou',
        39,
      ),
    ).toMatchObject({ area: "top-level", typed: "_sou" });
    const fieldSource = `POST /anocs_new/_search
{
  "query": {
    "term": {
      "gid`;
    expect(
      elasticsearchConsoleCompletionContext(fieldSource, fieldSource.length),
    ).toMatchObject({
      area: "field-name",
      typed: "gid",
      ownerKey: "term",
    });

    const aggregationType = `POST /anocs_new/_search
{
  "aggs": {
    "by_status": {
      "`;
    expect(
      elasticsearchConsoleCompletionContext(
        aggregationType,
        aggregationType.length,
      ),
    ).toMatchObject({ area: "aggregation-type" });
    expect(
      elasticsearchConsoleCompletions(
        aggregationType,
        aggregationType.length,
      ).map((item) => item.label),
    ).toContain("terms");
  });

  it("offers cached mapping fields between an auto-closed pair of quotes", () => {
    const source = `POST /qikan_summary/_search
{
  "query": {
    "match": {
      "": "value"
    }
  }
}`;
    const offset = source.indexOf('"": "value"') + 1;
    const context = elasticsearchConsoleCompletionContext(source, offset);

    expect(context).toMatchObject({
      area: "field-name",
      typed: "",
      ownerKey: "match",
    });
    expect(
      elasticsearchMappingFieldCompletions(
        [
          { name: "title", dataType: "text" },
          { name: "qid", dataType: "long" },
          { name: "title", dataType: "keyword" },
        ],
        context,
        "qikan_summary",
      ),
    ).toEqual([
      expect.objectContaining({
        label: "qid",
        insertText: '"qid"',
      }),
      expect.objectContaining({
        label: "title",
        insertText: '"title"',
      }),
    ]);
  });

  it("binds completion context to the request under the cursor", () => {
    const source = `POST /current-index/_search
{"query":{"match_all":{}}}

POST /archive/_search
{"query":{"term":{"gid":"1"}}}`;
    expect(
      elasticsearchConsoleRequestContext(
        source,
        source.indexOf("match_all"),
        "fallback",
      ),
    ).toMatchObject({
      method: "POST",
      path: "/current-index/_search",
      index: "current-index",
    });
    expect(
      elasticsearchConsoleRequestContext(
        source,
        source.lastIndexOf("gid"),
        "fallback",
      ),
    ).toMatchObject({ index: "archive" });
  });

  it("produces syntax-safe deterministic Smart Tab text", () => {
    expect(
      elasticsearchConsoleInlineSuggestion("POST ", 5, "anocs_new"),
    ).toBe(
      '/anocs_new/_search\n{\n  "query": {\n    "match_all": {}\n  }\n}',
    );
    const partial = 'POST /anocs_new/_search\n{\n  "_sou';
    expect(
      elasticsearchConsoleInlineSuggestion(partial, partial.length),
    ).toBe('rce": true');
    const completedKey = 'POST /anocs_new/_search\n{\n  "_source"';
    expect(
      elasticsearchConsoleInlineSuggestion(completedKey, completedKey.length),
    ).toBe(": true");
    const completedQuery = 'POST /anocs_new/_search\n{\n  "query"';
    expect(
      elasticsearchConsoleInlineSuggestion(
        completedQuery,
        completedQuery.length,
      ),
    ).toBe(': {\n  "match_all": {}\n}');
  });

  it("uses schema completions only for paths and mapping-field positions", () => {
    const lspItems = [
      {
        label: "anocs_new",
        detail: "Elasticsearch Index: anocs_new",
        insertText: '"anocs_new"',
      },
      {
        label: "gid",
        detail: "Elasticsearch field in anocs_new: gid",
        insertText: '"gid"',
      },
      {
        label: "gid",
        detail: "Elasticsearch field in older_index: gid",
        insertText: '"gid"',
      },
      {
        label: "legacy_only",
        detail: "Elasticsearch field in older_index: legacy_only",
        insertText: '"legacy_only"',
      },
      {
        label: "_source",
        detail: "Elasticsearch DSL field: _source",
        insertText: '"_source"',
      },
    ];

    expect(
      elasticsearchSchemaCompletionsForContext(
        lspItems,
        { area: "path", typed: "/ano" },
        "anocs_new",
      ),
    ).toMatchObject([
      {
        label: "anocs_new",
        insertText: "/anocs_new",
      },
    ]);
    expect(
      elasticsearchSchemaCompletionsForContext(
        lspItems,
        { area: "top-level", typed: "_sou" },
        "anocs_new",
      ),
    ).toEqual([]);
    expect(
      elasticsearchSchemaCompletionsForContext(
        lspItems,
        { area: "operation", typed: "_se", ownerKey: "anocs_new" },
        "anocs_new",
      ),
    ).toEqual([]);
    expect(
      elasticsearchSchemaCompletionsForContext(
        lspItems,
        { area: "field-name", typed: "g", ownerKey: "term" },
        "anocs_new",
      ),
    ).toMatchObject([
      {
        label: "gid",
        detail: "Elasticsearch field in anocs_new: gid",
      },
    ]);
  });

  it("formats JSON bodies without changing request lines", () => {
    expect(
      formatElasticsearchConsole(
        'POST products/_search\n{"query":{"match_all":{}}}\n\nGET /_cluster/health',
      ),
    ).toBe(`POST products/_search
{
  "query": {
    "match_all": {}
  }
}

GET /_cluster/health`);
  });

  it("does not execute request-shaped text inside line or block comments", () => {
    const source = `# GET /ignored
/*
POST /also-ignored/_search
{}
*/
POST /products/_search
{
  // GET /still-not-a-request
  "query": { "match_all": {} }
}`;

    expect(
      parseElasticsearchConsoleRequests(source).map((request) => request.text),
    ).toEqual([
      `POST /products/_search
{
  // GET /still-not-a-request
  "query": { "match_all": {} }
}`,
    ]);
    expect(prepareElasticsearchConsoleExecution(source)).not.toContain(
      "ignored",
    );
  });

  it("expands partial selections to complete requests", () => {
    const selectionStart = consoleScript.indexOf('"match_all"');
    const selectionEnd = selectionStart + '"match_all"'.length;

    expect(
      elasticsearchRequestsForSelection(
        consoleScript,
        selectionStart,
        selectionEnd,
      ).map((request) => request.text),
    ).toEqual([
      `POST products/_search
{
  "query": { "match_all": {} }
}`,
    ]);

    expect(
      elasticsearchRequestsForSelection(
        consoleScript,
        consoleScript.indexOf("GET /products"),
        consoleScript.length,
      ),
    ).toHaveLength(2);
  });

  it("navigates between request starts without moving outside the document", () => {
    const first = consoleScript.indexOf("POST products");
    const second = consoleScript.indexOf("GET /products");
    const third = consoleScript.lastIndexOf("POST products");

    expect(
      elasticsearchRequestNavigationOffset(consoleScript, first, "next"),
    ).toBe(second);
    expect(
      elasticsearchRequestNavigationOffset(consoleScript, second, "next"),
    ).toBe(third);
    expect(
      elasticsearchRequestNavigationOffset(consoleScript, third, "next"),
    ).toBe(third);
    expect(
      elasticsearchRequestNavigationOffset(consoleScript, first, "previous"),
    ).toBe(first);
  });

  it("validates JSON, JSON with comments, variables, and NDJSON per request", () => {
    expect(
      validateElasticsearchConsole(`POST /products/_search
{
  // Console comments are allowed.
  "query": { "term": { "status": "\${status}" } }
}`),
    ).toEqual([]);

    expect(
      validateElasticsearchConsole(`POST /products/_search
{
  "query": { "match_all": }
}`)[0]?.message,
    ).toContain("Invalid JSON request body");

    expect(
      validateElasticsearchConsole(`POST /_bulk
{"index":{"_index":"products","_id":"1"}}
{"name":"Oxide"}
{"broken":}
`)[0]?.message,
    ).toContain("Invalid NDJSON line");

    expect(
      validateElasticsearchConsole(
        "GET https://search.example.test/products/_search",
      )[0]?.message,
    ).toContain("relative Elasticsearch API path");
    expect(
      validateElasticsearchConsole('POST "products"/_search\n{}')[0]?.message,
    ).toContain("Do not quote");
  });

  it("extracts and substitutes typed Console variables locally", () => {
    const source = `POST /\${index}/_search
{
  "size": "\${size}",
  "query": {
    "term": {
      "\${field}": """\${value}"""
    }
  }
}`;

    expect(elasticsearchConsoleVariableNames(source)).toEqual([
      "index",
      "size",
      "field",
      "value",
    ]);
    expect(
      compileElasticsearchConsoleExecution(source, {
        index: "products",
        size: "25",
        field: "status",
        value: "true",
      }),
    ).toBe(`POST /products/_search
{
  "size": 25,
  "query": {
    "term": {
      "status": "true"
    }
  }
}`);
    expect(() =>
      compileElasticsearchConsoleExecution(source, { index: "products" }),
    ).toThrow('variable "${size}" needs a value');
  });
});
