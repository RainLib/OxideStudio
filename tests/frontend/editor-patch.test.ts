import { beforeEach, describe, expect, it } from "vitest";
import {
  applyEditorTextPatch,
  fullDocumentRange,
  textInEditorRange,
} from "@/lib/editorPatch";
import { documentTextRevision } from "@/lib/documentRevision";
import { useTabStore } from "@/store/useTabStore";

describe("editor patch domain", () => {
  beforeEach(() => {
    useTabStore.setState({
      activeTabId: "tab-1",
      closedTabsStack: [],
      tabs: [
        {
          id: "tab-1",
          title: "Query",
          type: "query",
          sql: "SELECT id\r\nFROM users;",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });
  });

  it("maps one-based Monaco ranges across CRLF and applies exact replacement", () => {
    const source = "SELECT id\r\nFROM users;";
    const range = {
      startLine: 1,
      startColumn: 8,
      endLine: 2,
      endColumn: 11,
    };
    expect(textInEditorRange(source, range)).toBe("id\r\nFROM users");
    expect(
      applyEditorTextPatch(
        source,
        range,
        "id\r\nFROM users",
        "name\nFROM accounts",
      ),
    ).toEqual({
        status: "success",
        text: "SELECT name\nFROM accounts;",
        appliedRange: {
          startLine: 1,
          startColumn: 8,
          endLine: 2,
          endColumn: 14,
        },
      });
    expect(fullDocumentRange(source)).toEqual({
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 12,
    });
  });

  it("rejects stale original text and invalid ranges", () => {
    expect(
      applyEditorTextPatch(
        "SELECT 2",
        { startLine: 1, startColumn: 8, endLine: 1, endColumn: 9 },
        "1",
        "3",
      ),
    ).toMatchObject({ status: "stale" });
    expect(
      textInEditorRange("SELECT 1", {
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 2,
      }),
    ).toBeNull();
  });

  it("revalidates the whole document revision before applying a preview", () => {
    const store = useTabStore.getState();
    const source = store.tabs[0]!.sql;
    store.previewEditorPatch("tab-1", {
      id: "patch-1",
      title: "Use accounts",
      range: { startLine: 2, startColumn: 6, endLine: 2, endColumn: 11 },
      originalText: "users",
      replacement: "accounts",
      expectedRevision: documentTextRevision(null, source),
    });
    const applied = useTabStore
      .getState()
      .applyEditorPatchPreview("tab-1", "patch-1");
    expect(applied).toMatchObject({ status: "success" });
    expect(useTabStore.getState().tabs[0]?.sql).toBe(
      "SELECT id\r\nFROM accounts;",
    );
    expect(useTabStore.getState().tabs[0]?.editorPatchPreview).toBeNull();

    const current = useTabStore.getState().tabs[0]!;
    useTabStore.getState().previewEditorPatch("tab-1", {
      id: "patch-2",
      title: "Stale",
      range: fullDocumentRange(current.sql),
      originalText: current.sql,
      replacement: "SELECT 1",
      expectedRevision: documentTextRevision(null, current.sql),
    });
    useTabStore.getState().updateTabSql("tab-1", `${current.sql}\n-- changed`);
    expect(
      useTabStore.getState().applyEditorPatchPreview("tab-1", "patch-2"),
    ).toMatchObject({ status: "stale" });
  });
});
