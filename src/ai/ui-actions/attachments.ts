import type {
  AssistantToolCallResult,
} from "@/ai/assistant/types";
import type { AiToolExecutionContext } from "@/ai/tools/types";
import { captureWorkspaceUiActionContext, documentRevisionForTab } from "./context";
import type {
  AssistantAttachment,
  UiActionName,
  UiActionRange,
  UiActionRequest,
  UiActionTarget,
} from "./types";

const MAX_ATTACHMENTS_PER_MESSAGE = 8;

export function createAssistantAttachments(
  results: AssistantToolCallResult[],
  toolContext: AiToolExecutionContext
) {
  const context = captureWorkspaceUiActionContext();
  const attachments: AssistantAttachment[] = [];

  for (const result of results) {
    if (result.status !== "success") continue;
    if (result.toolName === "workspace.getActiveTab") {
      const tab = record(result.output);
      const tabId = stringValue(tab?.id);
      if (tabId) {
        attachments.push(
          attachment({
            id: `${result.id}-active-tab`,
            kind: "tab",
            label: stringValue(tab?.title) || "Active editor",
            detail: "Workspace tab",
            action: actionRequest(
              `${result.id}-open-tab`,
              "workspace.openTab",
              { projectId: context.projectId, tabId },
              "Open tab",
              context
            ),
          })
        );
        const fileRelativePath = stringValue(tab?.fileRelativePath);
        if (fileRelativePath) {
          attachments.push(
            attachment({
              id: `${result.id}-file`,
              kind: "file",
              label: fileRelativePath.split("/").pop() || fileRelativePath,
              detail: fileRelativePath,
              action: actionRequest(
                `${result.id}-reveal-file`,
                "project.revealFile",
                { projectId: context.projectId, relativePath: fileRelativePath },
                "Open project file",
                context
              ),
            })
          );
        }
        const resultSetCount = numberValue(tab?.resultSetCount);
        if (resultSetCount && resultSetCount > 0) {
          const activeResultIndex = numberValue(tab?.activeResultIndex) || 0;
          attachments.push(
            attachment({
              id: `${result.id}-result`,
              kind: "result",
              label: `${resultSetCount} result set${resultSetCount === 1 ? "" : "s"}`,
              detail: stringValue(tab?.title) || "Query results",
              action: actionRequest(
                `${result.id}-reveal-result`,
                "results.reveal",
                {
                  projectId: context.projectId,
                  tabId,
                  resultId: `${tabId}:${activeResultIndex}`,
                  resultIndex: activeResultIndex,
                },
                "Reveal results",
                context
              ),
            })
          );
        }
      }
      const objectAttachment = databaseObjectAttachment(
        `${result.id}-active-object`,
        {
          connectionId: stringValue(tab?.connectionId),
          databaseName: stringValue(tab?.databaseName),
          schemaName: stringValue(tab?.schemaName),
          objectName: stringValue(tab?.tableName),
          objectType: stringValue(tab?.objectType),
        },
        context
      );
      if (objectAttachment) attachments.push(objectAttachment);
    }

    if (result.toolName === "workspace.getSelection") {
      const selection = record(result.output);
      const tabId = stringValue(selection?.tabId);
      const range = editorSelectionRange(selection);
      if (tabId && range) {
        attachments.push(
          editorRangeAttachment(
            `${result.id}-selection`,
            tabId,
            range,
            stringValue(selection?.tabTitle) || "Editor selection",
            "Selected SQL",
            context
          )
        );
      }
    }

    if (result.toolName === "metadata.describeObject") {
      const description = record(result.output);
      const objectAttachment = databaseObjectAttachment(
        `${result.id}-object`,
        {
          connectionId:
            stringValue(description?.connectionId) ||
            toolContext.activeConnectionId ||
            undefined,
          databaseName: toolContext.activeTab?.databaseName || undefined,
          schemaName:
            stringValue(description?.namespace) ||
            toolContext.activeNamespace ||
            undefined,
          objectName: stringValue(description?.name),
          objectType:
            stringValue(description?.type) || stringValue(description?.kind),
        },
        context
      );
      if (objectAttachment) attachments.push(objectAttachment);
    }

    if (
      result.toolName === "metadata.listObjects" ||
      result.toolName === "metadata.listCollections"
    ) {
      const objects = Array.isArray(result.output) ? result.output : [];
      for (const [index, item] of objects.slice(0, 5).entries()) {
        const object = record(item);
        const objectAttachment = databaseObjectAttachment(
          `${result.id}-object-${index}`,
          {
            connectionId: toolContext.activeConnectionId || undefined,
            databaseName: toolContext.activeTab?.databaseName || undefined,
            schemaName:
              stringValue(object?.namespace) ||
              toolContext.activeNamespace ||
              undefined,
            objectName: stringValue(object?.name),
            objectType:
              stringValue(object?.type) || stringValue(object?.kind),
          },
          context
        );
        if (objectAttachment) attachments.push(objectAttachment);
      }
    }

    if (result.toolName === "lsp.explainDiagnostics") {
      const explanation = record(result.output);
      const tabId = stringValue(explanation?.tabId);
      const diagnostics = Array.isArray(explanation?.diagnostics)
        ? explanation.diagnostics
        : [];
      if (tabId) {
        for (const [index, item] of diagnostics.slice(0, 5).entries()) {
          const diagnostic = record(item);
          const range = lspRange(diagnostic?.range);
          if (!range) continue;
          attachments.push(
            editorRangeAttachment(
              `${result.id}-diagnostic-${index}`,
              tabId,
              range,
              stringValue(diagnostic?.message) || `Diagnostic ${index + 1}`,
              stringValue(diagnostic?.location) || "SQL diagnostic",
              context
            )
          );
        }
      }
    }
  }

  return deduplicateAttachments(attachments).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
}

function databaseObjectAttachment(
  id: string,
  target: {
    connectionId?: string;
    databaseName?: string;
    schemaName?: string;
    objectName?: string;
    objectType?: string;
  },
  context: ReturnType<typeof captureWorkspaceUiActionContext>
): AssistantAttachment | null {
  if (!target.connectionId || !target.schemaName || !target.objectName) return null;
  const uiTarget: UiActionTarget = {
    projectId: context.projectId,
    connectionId: target.connectionId,
    databaseName: target.databaseName,
    schemaName: target.schemaName,
    objectName: target.objectName,
    objectType: target.objectType,
  };
  const qualifiedName = [
    target.databaseName,
    target.schemaName,
    target.objectName,
  ]
    .filter(Boolean)
    .join(".");

  return attachment({
    id,
    kind: "databaseObject",
    label: target.objectName,
    detail: qualifiedName,
    action: actionRequest(
      `${id}-reveal`,
      "database.revealObject",
      uiTarget,
      `Reveal ${qualifiedName}`,
      context
    ),
    secondaryActions: [
      actionRequest(
        `${id}-data`,
        "database.openObjectData",
        uiTarget,
        "Open data",
        context
      ),
      actionRequest(
        `${id}-ddl`,
        "database.openObjectDdl",
        uiTarget,
        "Open DDL",
        context
      ),
    ],
  });
}

function editorRangeAttachment(
  id: string,
  tabId: string,
  range: UiActionRange,
  label: string,
  detail: string,
  context: ReturnType<typeof captureWorkspaceUiActionContext>
): AssistantAttachment {
  return attachment({
    id,
    kind: "editorRange",
    label,
    detail,
    action: actionRequest(
      `${id}-reveal`,
      "editor.revealRange",
      { projectId: context.projectId, tabId, range },
      "Reveal in editor",
      context,
      documentRevisionForTab(tabId)
    ),
  });
}

function actionRequest(
  id: string,
  action: UiActionName,
  target: UiActionTarget,
  label: string,
  context: ReturnType<typeof captureWorkspaceUiActionContext>,
  documentRevision?: string | null
): UiActionRequest {
  return {
    id,
    action,
    target,
    issuedAgainst: {
      projectId: context.projectId,
      contextVersion: context.contextVersion,
      ...(documentRevision ? { documentRevision } : {}),
    },
    presentation: { label, reveal: true, focus: true },
  };
}

function attachment(value: AssistantAttachment) {
  return value;
}

function deduplicateAttachments(attachments: AssistantAttachment[]) {
  const keys = new Set<string>();
  return attachments.filter((item) => {
    const target = item.action.target;
    const key = JSON.stringify([
      item.kind,
      item.action.action,
      target.connectionId,
      target.databaseName,
      target.schemaName,
      target.objectName,
      target.tabId,
      target.range,
    ]);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function editorSelectionRange(value: Record<string, unknown> | null) {
  if (!value) return null;
  return numericRange({
    startLine: value.startLineNumber,
    startColumn: value.startColumn,
    endLine: value.endLineNumber,
    endColumn: value.endColumn,
  });
}

function lspRange(value: unknown) {
  const range = record(value);
  const start = record(range?.start);
  const end = record(range?.end);
  if (!start || !end) return null;
  const zeroBased = numericRange({
    startLine: start.line,
    startColumn: start.character,
    endLine: end.line,
    endColumn: end.character,
  }, true);
  if (!zeroBased) return null;
  return {
    startLine: zeroBased.startLine + 1,
    startColumn: zeroBased.startColumn + 1,
    endLine: zeroBased.endLine + 1,
    endColumn: zeroBased.endColumn + 1,
  };
}

function numericRange(
  values: Record<keyof UiActionRange, unknown>,
  allowZero = false
): UiActionRange | null {
  const range = values as Record<keyof UiActionRange, number>;
  const minimum = allowZero ? 0 : 1;
  if (
    Object.values(range).some(
      (value) => !Number.isInteger(value) || value < minimum
    )
  ) {
    return null;
  }
  return range;
}
