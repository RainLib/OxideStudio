import { describe, expect, it, vi } from "vitest";
import {
  enqueueLspDocumentSync,
  syncLspModelBeforeCompletion,
} from "@/features/query-editor";

describe("QueryEditor LSP document sync", () => {
  it("sends the latest model text before requesting completions", async () => {
    const uri = "oxide://query/query-1.postgres.postgres";
    const openedDocuments = new Set<string>();
    const documentVersions = new Map<string, number>();
    const documentTexts = new Map<string, string>();
    const client = {
      didOpen: vi.fn().mockResolvedValue(undefined),
      didChange: vi.fn().mockResolvedValue(undefined),
    };
    const model = {
      getValue: vi.fn(() => "SELECT * from"),
    };

    await syncLspModelBeforeCompletion({
      uri,
      model,
      languageId: "postgres",
      client,
      openedDocuments,
      documentVersions,
      documentTexts,
    });

    expect(client.didOpen).toHaveBeenCalledWith(
      uri,
      "SELECT * from",
      1,
      "postgres"
    );
    expect(client.didChange).not.toHaveBeenCalled();
    expect(openedDocuments.has(uri)).toBe(true);
    expect(documentVersions.get(uri)).toBe(1);

    model.getValue.mockReturnValue("SELECT * from public.webhook where ");

    await syncLspModelBeforeCompletion({
      uri,
      model,
      languageId: "postgres",
      client,
      openedDocuments,
      documentVersions,
      documentTexts,
    });

    expect(client.didChange).toHaveBeenCalledWith(
      uri,
      "SELECT * from public.webhook where ",
      2
    );
    expect(client.didOpen).toHaveBeenCalledTimes(1);
    expect(documentVersions.get(uri)).toBe(2);

    await syncLspModelBeforeCompletion({
      uri,
      model,
      languageId: "postgres",
      client,
      openedDocuments,
      documentVersions,
      documentTexts,
    });
    expect(client.didChange).toHaveBeenCalledTimes(1);
    expect(documentVersions.get(uri)).toBe(2);
  });

  it("does not commit local document state when didOpen fails", async () => {
    const uri = "oxide://query/query-retry.postgres.postgres";
    const openedDocuments = new Set<string>();
    const documentVersions = new Map<string, number>();
    const documentTexts = new Map<string, string>();
    const client = {
      didOpen: vi
        .fn()
        .mockRejectedValueOnce(new Error("LSP restarting"))
        .mockResolvedValueOnce(undefined),
      didChange: vi.fn().mockResolvedValue(undefined),
    };
    const model = { getValue: vi.fn(() => "SELECT 1") };

    await expect(
      syncLspModelBeforeCompletion({
        uri,
        model,
        languageId: "postgres",
        client,
        openedDocuments,
        documentVersions,
        documentTexts,
      }),
    ).rejects.toThrow("LSP restarting");

    expect(openedDocuments.has(uri)).toBe(false);
    expect(documentVersions.has(uri)).toBe(false);
    expect(documentTexts.has(uri)).toBe(false);

    await syncLspModelBeforeCompletion({
      uri,
      model,
      languageId: "postgres",
      client,
      openedDocuments,
      documentVersions,
      documentTexts,
    });

    expect(client.didOpen).toHaveBeenLastCalledWith(uri, "SELECT 1", 1, "postgres");
    expect(client.didChange).not.toHaveBeenCalled();
  });

  it("retries the same revision when didChange fails", async () => {
    const uri = "oxide://query/query-change-retry.postgres.postgres";
    const openedDocuments = new Set([uri]);
    const documentVersions = new Map([[uri, 1]]);
    const documentTexts = new Map([[uri, "SELECT 1"]]);
    const client = {
      didOpen: vi.fn().mockResolvedValue(undefined),
      didChange: vi
        .fn()
        .mockRejectedValueOnce(new Error("transport reset"))
        .mockResolvedValueOnce(undefined),
    };
    const model = { getValue: vi.fn(() => "SELECT 2") };

    await expect(
      syncLspModelBeforeCompletion({
        uri,
        model,
        languageId: "postgres",
        client,
        openedDocuments,
        documentVersions,
        documentTexts,
      }),
    ).rejects.toThrow("transport reset");

    expect(documentVersions.get(uri)).toBe(1);
    expect(documentTexts.get(uri)).toBe("SELECT 1");

    await syncLspModelBeforeCompletion({
      uri,
      model,
      languageId: "postgres",
      client,
      openedDocuments,
      documentVersions,
      documentTexts,
    });

    expect(client.didChange).toHaveBeenLastCalledWith(uri, "SELECT 2", 2);
    expect(documentVersions.get(uri)).toBe(2);
  });

  it("serializes fast document updates and recovers the queue after a failure", async () => {
    const uri = "oxide://query/query-queue.postgres.postgres";
    const chains = new Map<string, Promise<void>>();
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = enqueueLspDocumentSync(chains, uri, async () => {
      calls.push("open");
      await firstGate;
    });
    const second = enqueueLspDocumentSync(chains, uri, async () => {
      calls.push("change");
      throw new Error("transport reset");
    });
    const third = enqueueLspDocumentSync(chains, uri, async () => {
      calls.push("retry");
    });

    await vi.waitFor(() => expect(calls).toEqual(["open"]));
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow("transport reset");
    await third;

    expect(calls).toEqual(["open", "change", "retry"]);
    expect(chains.has(uri)).toBe(false);
  });
});
