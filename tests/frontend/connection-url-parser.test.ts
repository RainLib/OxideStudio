import { describe, expect, it } from "vitest";
import {
  applyElasticsearchIndexGroupingPattern,
  buildConnectionUrl,
  normalizeConnectionUrlForDriver,
  parseConnectionUrl,
} from "@/lib/connectionUrlParser";

describe("Elasticsearch connection URLs", () => {
  it("uses HTTP when SSL is disabled and HTTPS when SSL is enabled", () => {
    expect(
      buildConnectionUrl({
        driver: "elasticsearch",
        host: "search.example.test",
        port: 9200,
        sslMode: "disable",
      }),
    ).toBe("http://search.example.test:9200");

    expect(
      buildConnectionUrl({
        driver: "elasticsearch",
        host: "search.example.test",
        port: 9200,
        sslMode: "verify-full",
      }),
    ).toBe("https://search.example.test:9200");
  });

  it("parses HTTPS as Elasticsearch without changing the driver", () => {
    expect(
      parseConnectionUrl(
        "https://reader:p%40ss%3Aword@search.example.test:9200",
        "elasticsearch",
      ),
    ).toMatchObject({
      driver: "elasticsearch",
      host: "search.example.test",
      port: 9200,
      user: "reader",
      password: "p@ss:word",
      sslMode: "require",
    });
  });

  it("normalizes Elasticsearch aliases and consumes the internal SSL flag", () => {
    const normalized = normalizeConnectionUrlForDriver(
      "elasticsearch",
      "elasticsearch://reader:password@search.example.test:9200?ssl=require&request_cache=true",
    );
    const url = new URL(normalized);

    expect(url.protocol).toBe("https:");
    expect(url.searchParams.has("ssl")).toBe(false);
    expect(url.searchParams.get("request_cache")).toBe("true");
  });

  it("adds or clears the optional rolling-index grouping pattern", () => {
    const grouped = new URL(
      applyElasticsearchIndexGroupingPattern(
        "https://search.example.test:9200?request_cache=true",
        "[-_.@]\\d{4}[-_.]?\\d{2}.*$",
      ),
    );
    expect(grouped.searchParams.get("request_cache")).toBe("true");
    expect(grouped.searchParams.get("indexGroupingPattern")).toBe(
      "[-_.@]\\d{4}[-_.]?\\d{2}.*$",
    );

    const cleared = new URL(
      applyElasticsearchIndexGroupingPattern(grouped.toString(), "  "),
    );
    expect(cleared.searchParams.has("indexGroupingPattern")).toBe(false);
  });
});

describe("file-backed SQL connection URLs", () => {
  it("keeps local file and in-memory paths out of the network URL builder", () => {
    expect(
      buildConnectionUrl({ driver: "sqlite", database: ":memory:" }),
    ).toBe("sqlite::memory:");
    expect(
      buildConnectionUrl({
        driver: "sqlite",
        database: "/tmp/oxide.sqlite",
      }),
    ).toBe("sqlite:///tmp/oxide.sqlite");
    expect(parseConnectionUrl("sqlite:///tmp/oxide.sqlite")).toMatchObject({
      driver: "sqlite",
      database: "/tmp/oxide.sqlite",
    });
  });
});

describe("signed external driver URL templates", () => {
  it("renders JDBC grammar without reducing it to the generic URL shape", () => {
    expect(
      buildConnectionUrl({
        driver: "trino",
        host: "query.example.test",
        port: 8443,
        database: "hive/default",
        connectionUrlTemplate: "jdbc:trino://{host}:{port}/{database}",
      }),
    ).toBe("jdbc:trino://query.example.test:8443/hive/default");
  });

  it("keeps a package-pinned JDBC prefix for the sidecar", () => {
    expect(
      normalizeConnectionUrlForDriver(
        "oracle",
        "jdbc:oracle:thin:@db.example.test:1521/ORCLPDB1",
        { preserveJdbcPrefix: true },
      ),
    ).toBe("jdbc:oracle:thin:@db.example.test:1521/ORCLPDB1");
  });
});
