import { describe, expect, it } from "vitest";
import {
  applyElasticsearchConnectionOptions,
  elasticsearchConnectionOptionsFromQueryParams,
  normalizeElasticsearchConnectivityCheckPath,
  normalizeKibanaBasePath,
  parseConnectionUrl,
} from "./connectionUrlParser";

describe("Elasticsearch connection URL options", () => {
  it("serializes the complete proxy and safety configuration", () => {
    const value = applyElasticsearchConnectionOptions(
      "https://elastic.example.test:5601/",
      {
        mode: "kibana",
        kibanaBasePath: " /kibana/s/analytics/ ",
        connectivityCheckPath: "GET logs-*/_search\n{\"size\":0}",
        connectivityCheckDisabled: true,
        indexGroupingPattern: " [-_]\\d+ ",
      },
    );
    const parsed = new URL(value);

    expect(parsed.searchParams.get("mode")).toBe("kibana");
    expect(parsed.searchParams.get("kibanaBasePath")).toBe(
      "/kibana/s/analytics",
    );
    expect(parsed.searchParams.get("connectivityCheckPath")).toBe(
      "/logs-*/_search",
    );
    expect(parsed.searchParams.get("connectivityCheckDisabled")).toBe("true");
    expect(parsed.searchParams.get("indexGroupingPattern")).toBe("[-_]\\d+");
  });

  it("removes stale internal values when returning to direct defaults", () => {
    const value = applyElasticsearchConnectionOptions(
      "http://localhost:9200/?MODE=kibana&kibanaBasePath=%2Fold&connectivityCheckDisabled=true&indexGroupingPattern=old",
      { mode: "direct" },
    );

    expect(new URL(value).search).toBe("");
  });

  it("round-trips case-insensitive URL parameters into form fields", () => {
    const parsed = parseConnectionUrl(
      "http://localhost:5601?MODE=kibana&KIBANABASEPATH=%2Fs%2Fteam&CONNECTIVITYCHECKDISABLED=on",
      "elasticsearch",
    );
    const options = elasticsearchConnectionOptionsFromQueryParams(
      parsed?.queryParams,
    );

    expect(options).toMatchObject({
      mode: "kibana",
      kibanaBasePath: "/s/team",
      connectivityCheckDisabled: true,
    });
  });

  it("normalizes pasted GET paths and deployment base paths", () => {
    expect(
      normalizeElasticsearchConnectivityCheckPath(
        "GET protected-index/_search\n{\"size\": 0}",
      ),
    ).toBe("/protected-index/_search");
    expect(normalizeElasticsearchConnectivityCheckPath("GET /")).toBe("");
    expect(normalizeKibanaBasePath("//kibana/s/team//")).toBe(
      "/kibana/s/team",
    );
  });
});
