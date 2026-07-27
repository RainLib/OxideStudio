/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessageContent } from "@/components/workspace/assistant/AssistantMessageContent";
import {
  createAssistantSqlPatchPreview,
  isSqlAssistantCodeBlock,
} from "@/lib/assistantSqlPatch";
import { documentTextRevision } from "@/lib/documentRevision";
import {
  queryErrorFixPrompt,
  useAssistantComposerStore,
} from "@/store/useAssistantComposerStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const queryError = {
  code: "QUERY_EXECUTION_FAILED",
  message: "duplicate key value",
  retryable: false,
  database: {
    driver: "postgres" as const,
    sqlState: "23505",
    documentLine: 3,
    documentColumn: 12,
    constraint: "users_email_key",
  },
};

describe("assistant query error fix flow", () => {
  it("builds a bounded diagnostic prompt that forbids execution and automatic apply", () => {
    const prompt = queryErrorFixPrompt(queryError);

    expect(prompt).toContain("SQLSTATE 23505");
    expect(prompt).toContain("line 3, column 12");
    expect(prompt).toContain("constraint users_email_key");
    expect(prompt).toContain("Do not run the SQL");
    expect(prompt).toContain("do not apply any editor change");
    expect(prompt).not.toContain("postgres://");
  });

  it("queues and consumes one compose request without persisting SQL text", () => {
    useAssistantComposerStore.setState({ request: null });
    const request = useAssistantComposerStore
      .getState()
      .queueQueryErrorFix("tab-1", queryError);

    expect(request.tabId).toBe("tab-1");
    expect(request.prompt).not.toContain("SELECT");
    useAssistantComposerStore.getState().consumeRequest(request.id);
    expect(useAssistantComposerStore.getState().request).toBeNull();
  });

  it("creates a revision-bound selection patch without changing the editor text", () => {
    const sql = "SELECT id, email FROM users WHERE id = 1";
    const patch = createAssistantSqlPatchPreview(
      {
        id: "tab-1",
        type: "query",
        title: "Users",
        sql,
        editorSelection: {
          text: "id = 1",
          startLineNumber: 1,
          startColumn: 35,
          endLineNumber: 1,
          endColumn: 41,
        },
      },
      "id = 2",
      "patch-1",
    );

    expect(patch).toMatchObject({
      id: "patch-1",
      originalText: "id = 1",
      replacement: "id = 2",
      expectedRevision: documentTextRevision(undefined, sql),
    });
    expect(sql).toBe("SELECT id, email FROM users WHERE id = 1");
  });

  it("prefers the failed execution range over replacing a multi-statement document", () => {
    const sql = "SELECT 1;\nSELECT FROM users;\nSELECT 3;";
    const patch = createAssistantSqlPatchPreview(
      {
        id: "tab-1",
        type: "query",
        title: "Script",
        sql,
      },
      "SELECT id FROM users;",
      "patch-2",
      {
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 19,
      },
    );

    expect(patch?.originalText).toBe("SELECT FROM users;");
    expect(patch?.range).toEqual({
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 19,
    });
  });

  it("offers preview only for explicitly fenced SQL code", async () => {
    const preview = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AssistantMessageContent
          content={"```sql\nSELECT 2;\n```\n```json\n{\"ok\":true}\n```"}
          onPreviewSqlPatch={preview}
        />,
      );
    });

    expect(isSqlAssistantCodeBlock("postgresql")).toBe(true);
    expect(
      container.querySelectorAll(
        'button[aria-label="Preview SQL in editor"]',
      ),
    ).toHaveLength(1);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Preview SQL in editor"]',
        )
        ?.click();
    });
    expect(preview).toHaveBeenCalledWith("SELECT 2;");

    await act(async () => root.unmount());
    container.remove();
  });
});
