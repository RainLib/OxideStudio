import { describe, expect, it } from "vitest";
import {
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
});
