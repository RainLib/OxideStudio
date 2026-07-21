/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElasticsearchResponseView } from "@/components/workspace/ElasticsearchResponseView";
import type { QueryResult } from "@/services/tauri";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const searchResult: QueryResult = {
  columns: [{ name: "name", data_type: "keyword" }],
  rows: [["Oxide"]],
  responseMeta: {
    requestMethod: "POST",
    requestPath: "/products/_search",
    status: 200,
    durationMs: 17,
    rawResponse: {
      hits: {
        hits: [{ _source: { name: "Oxide" } }],
      },
    },
  },
};

describe("ElasticsearchResponseView", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("defaults search responses to the flattened table and exposes raw JSON", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ElasticsearchResponseView result={searchResult}>
          <div data-testid="table-result">table result</div>
        </ElasticsearchResponseView>,
      );
    });

    expect(container.textContent).toContain("HTTP 200");
    expect(container.textContent).toContain("17 ms");
    expect(container.textContent).toContain("POST /products/_search");
    expect(container.querySelector('[data-testid="table-result"]')).not.toBeNull();

    const jsonButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("JSON response"),
    );
    await act(async () => jsonButton?.click());

    expect(container.querySelector("pre")?.textContent).toContain(
      '"name": "Oxide"',
    );
  });

  it("defaults mapping responses to raw JSON", async () => {
    const mappingResult: QueryResult = {
      ...searchResult,
      responseMeta: {
        ...searchResult.responseMeta!,
        requestMethod: "GET",
        requestPath: "/products/_mapping",
        rawResponse: {
          products: { mappings: { properties: { name: { type: "keyword" } } } },
        },
      },
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <ElasticsearchResponseView result={mappingResult}>
          <div>table result</div>
        </ElasticsearchResponseView>,
      );
    });

    expect(container.querySelector("pre")?.textContent).toContain(
      '"type": "keyword"',
    );
  });
});
