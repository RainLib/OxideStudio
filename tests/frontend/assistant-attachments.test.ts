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
  id = "tool-1",
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
      toolContext,
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
    expect(
      attachment?.secondaryActions?.map((action) => action.action),
    ).toEqual(["database.openObjectData", "database.openObjectDdl"]);
  });

  it("does not collapse same-named objects from different schemas", () => {
    const attachments = createAssistantAttachments(
      [
        success("metadata.listObjects", [
          { name: "users", namespace: "public", kind: "relation" },
          { name: "users", namespace: "audit", kind: "relation" },
        ]),
      ],
      toolContext,
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
      toolContext,
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

  it("creates an exact execution-plan attachment that reveals the normalized node", () => {
    const [attachment] = createAssistantAttachments(
      [
        success("query.explain", {
          id: "plan-1",
          driver: "postgres",
          mode: "estimate",
          root: {
            id: "plan-1/root",
            nodeType: "Index Scan",
            children: [],
          },
        }),
      ],
      toolContext,
    );

    expect(attachment).toMatchObject({
      kind: "plan",
      label: "Explain Plan · Index Scan",
      detail: "postgres · estimate",
      action: {
        action: "plan.revealNode",
        target: {
          projectId: "project-1",
          tabId: "tab-1",
          planId: "plan-1",
          nodeId: "plan-1/root",
        },
      },
    });
  });

  it("creates a stable attachment for the selected schema change", () => {
    const attachment = createAssistantAttachments(
      [
        success("workspace.getActiveTab", {
          id: "diff-tab-1",
          type: "schema_diff",
          title: "Schema Diff · public",
          schemaDiffId: "diff-1",
          selectedSchemaChange: {
            id: "change-1",
            summary: "Drop target-only column users.legacy",
            risk: "destructive",
            relationName: "users",
            childName: "legacy",
          },
        }),
      ],
      toolContext,
    ).find((item) => item.kind === "schemaDiff");

    expect(attachment).toMatchObject({
      kind: "schemaDiff",
      label: "Drop target-only column users.legacy",
      detail: "destructive · users",
      action: {
        action: "schemaDiff.revealChange",
        target: {
          projectId: "project-1",
          tabId: "diff-tab-1",
          schemaDiffId: "diff-1",
          schemaChangeId: "change-1",
        },
      },
    });
  });
});
