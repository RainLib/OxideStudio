import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ELASTICSEARCH_CONSOLE_LANGUAGE_ID } from "@/lib/elasticsearchConsole";
import { attachConsoleAutoSuggest } from "./useConsoleAutoSuggest";

describe("Console auto-suggest lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces and rejects stale Elasticsearch model versions", async () => {
    let listener:
      | ((event: { changes: Array<{ text: string; rangeLength: number }> }) => void)
      | undefined;
    let version = 1;
    const model = {
      uri: { toString: () => "oxide-lsp://connection/query/elasticsearch" },
      getLanguageId: () => ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      getOffsetAt: () => 5,
      getValue: () => "GET /",
      getVersionId: () => version,
    };
    const trigger = vi.fn();
    const dispose = vi.fn();
    const editor = {
      getModel: () => model,
      getPosition: () => ({ lineNumber: 1, column: 6 }),
      hasTextFocus: () => true,
      trigger,
      onDidChangeModelContent: (next: typeof listener) => {
        listener = next;
        return { dispose };
      },
    };
    const attachment = attachConsoleAutoSuggest({ editor, delayMs: 45 });

    listener?.({ changes: [{ text: "/", rangeLength: 0 }] });
    await vi.advanceTimersByTimeAsync(44);
    expect(trigger).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(trigger).toHaveBeenCalledWith(
      "oxide.elasticsearch.autoSuggest",
      "editor.action.triggerSuggest",
      {},
    );

    trigger.mockClear();
    listener?.({ changes: [{ text: "/", rangeLength: 0 }] });
    version += 1;
    await vi.advanceTimersByTimeAsync(45);
    expect(trigger).not.toHaveBeenCalled();

    attachment.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
