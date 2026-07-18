import { describe, expect, it } from "vitest";
import { queryTextForLanguage } from "@/store/useTabStore";

describe("Elasticsearch query language execution", () => {
  it("keeps Query DSL and explicit REST requests unchanged", () => {
    const dsl = '{"query":{"match_all":{}}}';
    expect(
      queryTextForLanguage(dsl, "elasticsearch", "elasticsearch-dsl"),
    ).toBe(dsl);
    expect(
      queryTextForLanguage(
        'POST events/_eql/search\n{"query":"process where true"}',
        "elasticsearch",
        "elasticsearch-eql",
      ),
    ).toBe('POST events/_eql/search\n{"query":"process where true"}');
  });

  it("routes EQL text and JSON bodies to the EQL endpoint", () => {
    expect(
      queryTextForLanguage(
        'process where process.name == "curl"',
        "elasticsearch",
        "elasticsearch-eql",
      ),
    ).toBe(
      'POST /_eql/search\n{\n  "query": "process where process.name == \\"curl\\""\n}',
    );
    expect(
      queryTextForLanguage(
        '{"query":"any where true"}',
        "elasticsearch",
        "elasticsearch-eql",
      ),
    ).toBe('POST /_eql/search\n{"query":"any where true"}');
  });
});
