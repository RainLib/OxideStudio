import { beforeEach, describe, expect, it } from "vitest";
import { createAssistantAttachments } from "@/ai/ui-actions/attachments";
import { resetUiActionContextTracker } from "@/ai/ui-actions/context";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import type { AssistantToolCallResult } from "@/ai/assistant/types";
import type { AiToolExecutionContext } from "@/ai/tools/types";

const toolContext: AiToolExecutionContext = {
  requestId: "request-1",
  activeConnectionId: "connection-1",
  activeNamespace: "public",
  activeTab: {
    id: "tab-1",
    type: "query",
    title: "Query",
    databaseName: "app_db",
    connectionId: "connection-1",
  },
};

function success(
  toolName: string,
  output: unknown,
  id = "tool-1"
): AssistantToolCallResult {
  return { id, toolName, status: "success", output };
}

describe("assistant UI attachments", () => {
  beforeEach(() => {
    resetUiActionContextTracker();
    useProjectStore.setState({
      activeProjectId: "project-1",
      activeProjectName: "Project",
    });
    useConnectionStore.setState({ activeConnectionId: "connection-1" });
    useSchemaStore.setState({ currentSchema: "public" });
    useTabStore.setState({
      tabs: [
        {
          id: "tab-1",
          title: "Query",
          type: "query",
          sql: "select * from users",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
          connectionId: "connection-1",
          databaseName: "app_db",
          schemaName: "public",
        },
      ],
      activeTabId: "tab-1",
      closedTabsStack: [],
    });
  });

  it("keeps complete database identity and separates reveal, data, and DDL actions", () => {
    const [attachment] = createAssistantAttachments(
      [
        success("metadata.describeObject", {
          connectionId: "connection-1",
          namespace: "public",
          name: "users",
          kind: "relation",
        }),
      ],
      toolContext
    );

    expect(attachment).toMatchObject({
      kind: "databaseObject",
      label: "users",
      action: {
        action: "database.revealObject",
        target: {
          projectId: "project-1",
          connectionId: "connection-1",
          databaseName: "app_db",
          schemaName: "public",
          objectName: "users",
        },
      },
    });
    expect(attachment?.secondaryActions?.map((action) => action.action)).toEqual([
      "database.openObjectData",
      "database.openObjectDdl",
    ]);
  });

  it("does not collapse same-named objects from different schemas", () => {
    const attachments = createAssistantAttachments(
      [
        success("metadata.listObjects", [
          { name: "users", namespace: "public", kind: "relation" },
          { name: "users", namespace: "audit", kind: "relation" },
        ]),
      ],
      toolContext
    );

    expect(attachments).toHaveLength(2);
    expect(attachments.map((item) => item.action.target.schemaName)).toEqual([
      "public",
      "audit",
    ]);
  });

  it("converts LSP ranges to one-based editor coordinates and binds a revision", () => {
    const [attachment] = createAssistantAttachments(
      [
        success("lsp.explainDiagnostics", {
          tabId: "tab-1",
          diagnostics: [
            {
              message: "Unknown column",
              location: "line 1",
              range: {
                start: { line: 0, character: 7 },
                end: { line: 0, character: 12 },
              },
            },
          ],
        }),
      ],
      toolContext
    );

    expect(attachment).toMatchObject({
      kind: "editorRange",
      action: {
        action: "editor.revealRange",
        target: {
          tabId: "tab-1",
          range: {
            startLine: 1,
            startColumn: 8,
            endLine: 1,
            endColumn: 13,
          },
        },
        issuedAgainst: {
          projectId: "project-1",
          documentRevision: expect.any(String),
        },
      },
    });
  });
});
