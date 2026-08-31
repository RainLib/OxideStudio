// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  previewElasticsearchIndexClear: vi.fn(),
  executeElasticsearchIndexClear: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({ schemaService: services }));

import { ElasticsearchIndexClearDialog } from "./ElasticsearchIndexClearDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ElasticsearchIndexClearDialog", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    services.previewElasticsearchIndexClear.mockReset().mockResolvedValue({
      index: "logs-*",
      isPattern: true,
      documentCount: 10,
      requestPreview:
        'POST /logs-*/_delete_by_query?conflicts=proceed&refresh=true\n{ "query": { "match_all": {} } }',
      confirmationPhrase: "CLEAR logs-*",
      confirmationToken: "reviewed-token",
      serverVersion: "8.12.0",
    });
    services.executeElasticsearchIndexClear.mockReset().mockResolvedValue({
      total: 10,
      deleted: 8,
      versionConflicts: 2,
      timedOut: false,
      failures: [],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("requires the Host-provided phrase and reports partial deletion", async () => {
    const onCleared = vi.fn();
    await act(async () => {
      root.render(
        <ElasticsearchIndexClearDialog
          open
          connectionId="elastic-1"
          driver="elasticsearch"
          index="logs-*"
          onClose={() => undefined}
          onCleared={onCleared}
        />,
      );
    });
    await flush();

    const input = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Elasticsearch clear confirmation phrase"]',
    );
    const clearButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Clear Documents"),
    );
    expect(clearButton?.disabled).toBe(true);

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(input, "CLEAR logs-*");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(clearButton?.disabled).toBe(false);

    await act(async () => clearButton?.click());
    await flush();

    expect(services.executeElasticsearchIndexClear).toHaveBeenCalledWith(
      "elastic-1",
      "elasticsearch",
      {
        index: "logs-*",
        confirmationToken: "reviewed-token",
        confirmationPhrase: "CLEAR logs-*",
      },
    );
    expect(onCleared).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: 8, versionConflicts: 2 }),
      "logs-*",
    );
    expect(document.body.textContent).toContain("completed with documents that need review");
    expect(document.body.textContent).toContain("Conflicts");
  });
});
