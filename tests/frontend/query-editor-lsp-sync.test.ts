import { describe, expect, it, vi } from "vitest";
import { syncLspModelBeforeCompletion } from "@/components/workspace/QueryEditor";

vi.mock("@monaco-editor/react", () => ({
  default: () => null,
  useMonaco: () => null,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

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
});
