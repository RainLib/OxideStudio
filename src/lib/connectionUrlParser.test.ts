import { describe, expect, it } from "vitest";
import {
  applyInfluxDbConnectionOptions,
  applyVictoriaMetricsConnectionOptions,
  applyElasticsearchConnectionOptions,
  buildConnectionUrl,
  elasticsearchConnectionOptionsFromQueryParams,
  influxDbConnectionOptionsFromQueryParams,
  normalizeElasticsearchConnectivityCheckPath,
  normalizeKibanaBasePath,
  parseConnectionUrl,
  victoriaMetricsConnectionOptionsFromUrl,
} from "./connectionUrlParser";

describe("InfluxDB 3 connection URL", () => {
  it("encodes the API token and switches HTTP transport through SSL mode", () => {
    expect(
      buildConnectionUrl({
        driver: "influxdb3",
        host: "metrics.example.test",
        port: 8181,
        password: "token with spaces",
        database: "customer metrics",
        sslMode: "require",
      }),
    ).toBe(
      "https://:token%20with%20spaces@metrics.example.test:8181/customer%20metrics",
    );
  });
});

describe("VictoriaMetrics connection URL", () => {
  it("keeps arbitrary endpoint parameters while isolating the API mount and lookback", () => {
    const value = applyVictoriaMetricsConnectionOptions(
      "https://metrics.example.test/old?tenant=team-a&LOOKBACK=30m",
      { apiPath: " /select/tenant-a/prometheus/ ", lookback: "6h" },
    );
    const parsed = new URL(value);

    expect(parsed.pathname).toBe("/select/tenant-a/prometheus");
    expect(parsed.searchParams.get("tenant")).toBe("team-a");
    expect(victoriaMetricsConnectionOptionsFromUrl(value)).toEqual({
      apiPath: "/select/tenant-a/prometheus",
      lookback: "6h",
    });
  });
});

describe("InfluxDB 1.x / 2.x connection URL", () => {
  it("round-trips the explicit v2 organization without disturbing user URL parameters", () => {
    const url = applyInfluxDbConnectionOptions(
      "https://:token@metrics.example.test:8086/telemetry?precision=ns&APIversion=1&organization=old",
      { version: "2", organization: "team one" },
    );
    const parsed = new URL(url);

    expect(parsed.searchParams.get("precision")).toBe("ns");
    expect(parsed.searchParams.get("version")).toBe("2");
    expect(parsed.searchParams.get("org")).toBe("team one");
    expect(influxDbConnectionOptionsFromQueryParams(
      parseConnectionUrl(url, "influxdb")?.queryParams,
    )).toEqual({ version: "2", organization: "team one" });
  });

  it("removes v2-only routing fields when returning to InfluxDB 1.x", () => {
    const url = applyInfluxDbConnectionOptions(
      "http://localhost:8086/metrics?version=2&org=team&epoch=ms",
      { version: "1" },
    );
    expect(new URL(url).search).toBe("?epoch=ms");
  });
});

describe("Meilisearch connection URL", () => {
  it("preserves HTTP transport, API-key credentials and no database path", () => {
    const url = buildConnectionUrl({
      driver: "meilisearch",
      host: "search.example.test",
      port: 7700,
      password: "private key",
      database: "must-not-be-a-path",
      sslMode: "require",
    });

    expect(url).toBe("https://:private%20key@search.example.test:7700");
    expect(parseConnectionUrl(url, "meilisearch")).toMatchObject({
      driver: "meilisearch",
      host: "search.example.test",
      port: 7700,
      password: "private key",
      sslMode: "require",
    });
  });
});

describe("Easysearch connection URL", () => {
  it("shares Elasticsearch HTTP transport while preserving the selected product", () => {
    const url = buildConnectionUrl({
      driver: "easysearch",
      host: "search.example.test",
      port: 9200,
      password: "private key",
      database: "must-not-be-a-path",
      sslMode: "require",
    });

    expect(url).toBe("https://:private%20key@search.example.test:9200");
    expect(parseConnectionUrl(url, "easysearch")).toMatchObject({
      driver: "easysearch",
      host: "search.example.test",
      port: 9200,
      password: "private key",
      sslMode: "require",
    });
  });
});

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
