import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actions";
import { requestDatabaseObjectReveal } from "@/lib/databaseNavigation";
import { requestEditorRangeReveal } from "@/lib/editorNavigation";
import { findExplainPlanNode } from "@/lib/explainPlan";
import { requestExplainPlanNodeReveal } from "@/lib/explainPlanNavigation";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import { requestProjectFilesPanel } from "@/lib/projectFilesNavigation";
import { loadTableDdl } from "@/services/tableMetadataCache";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  captureWorkspaceUiActionContext,
  documentRevisionForTab,
} from "./context";
import { UiActionRegistry, uiActionResult } from "./registry";
import type { UiActionTarget } from "./types";

export function createWorkspaceUiActionRegistry() {
  const registry = new UiActionRegistry({
    captureContext: captureWorkspaceUiActionContext,
    documentRevisionForTab,
  });

  registry.register({
    name: "project.open",
    description:
      "Switch to an existing project using the normal unsaved-change guard.",
    validateTarget: requireFields("projectId"),
    execute: (target, context) => {
      const project = useProjectStore
        .getState()
        .projects.find((candidate) => candidate.id === target.projectId);
      if (!project)
        return notFound(context.actionId, "Project", target.projectId);
      if (!useProjectStore.getState().setActiveProject(project.id)) {
        return uiActionResult(
          context.actionId,
          "error",
          "ACTION_FAILED",
          "Project switch was cancelled to preserve unsaved changes.",
        );
      }
    },
  });

  registry.register({
    name: "project.revealFile",
    description:
      "Open a project file and reveal the Project Files tool window.",
    validateTarget: (target) =>
      requireFields("projectId", "relativePath")(target) ||
      validateRelativePath(target.relativePath!),
    execute: async (target) => {
      requestProjectFilesPanel();
      await openProjectFileInEditor(target.relativePath!);
    },
  });

  registry.register({
    name: "workspace.openTab",
    description: "Activate an existing workspace tab by stable tab id.",
    validateTarget: requireFields("projectId", "tabId"),
    execute: (target, context) => {
      const tab = useTabStore
        .getState()
        .tabs.find((candidate) => candidate.id === target.tabId);
      if (!tab) return notFound(context.actionId, "Tab", target.tabId!);
      useTabStore.getState().setActiveTab(tab.id);
      useWorkbenchLayoutStore.getState().setActiveToolWindow("editor");
    },
  });

  registry.register({
    name: "workspace.focusPanel",
    description: "Show and focus a workbench panel.",
    validateTarget: requireFields("projectId", "panelId"),
    execute: (target, context) => {
      if (target.panelId === "files") {
        requestProjectFilesPanel();
        return;
      }
      if (target.panelId === "tasks") {
        return unsupported(
          context.actionId,
          "Task Center navigation is not available yet.",
        );
      }
      useWorkbenchLayoutStore
        .getState()
        .setActiveToolWindow(
          target.panelId as
            "databaseExplorer" | "assistant" | "results" | "editor",
        );
    },
  });

  registry.register({
    name: "database.selectConnection",
    description: "Activate a saved data source by stable connection id.",
    validateTarget: requireFields("projectId", "connectionId"),
    execute: async (target, context) => {
      const connection = connectionById(target.connectionId!);
      if (!connection) {
        return notFound(context.actionId, "Data source", target.connectionId!);
      }
      const connectionError = await useConnectionStore
        .getState()
        .setActiveConnection(connection.id);
      if (connectionError) throw new Error(connectionError);
      useWorkbenchLayoutStore
        .getState()
        .setActiveToolWindow("databaseExplorer");
    },
  });

  registry.register({
    name: "database.revealObject",
    description: "Reveal an exact database object in Database Explorer.",
    validateTarget: validateDatabaseObjectTarget,
    execute: async (target, context) => {
      const connection = connectionById(target.connectionId!);
      if (!connection) {
        return notFound(context.actionId, "Data source", target.connectionId!);
      }
      const connectionError = await useConnectionStore
        .getState()
        .setActiveConnection(connection.id);
      if (connectionError) throw new Error(connectionError);
      useWorkbenchLayoutStore
        .getState()
        .setActiveToolWindow("databaseExplorer");
      requestDatabaseObjectReveal({
        projectId: target.projectId,
        connectionId: connection.id,
        databaseName: target.databaseName,
        schemaName: target.schemaName!,
        objectType: target.objectType,
        objectName: target.objectName!,
      });
    },
  });

  registry.register({
    name: "database.openObjectData",
    description: "Open a data tab for an exact database object.",
    validateTarget: validateDatabaseObjectTarget,
    execute: async (target, context) => {
      const connection = connectionById(target.connectionId!);
      if (!connection) {
        return notFound(context.actionId, "Data source", target.connectionId!);
      }
      const tabStore = useTabStore.getState();
      const tabId = tabStore.findOrCreateTableTab(
        connection.id,
        target.schemaName!,
        target.objectName!,
        target.objectType,
        target.databaseName,
      );
      await tabStore.loadTablePage(tabId, 0);
    },
  });

  registry.register({
    name: "database.openObjectDdl",
    description: "Load object DDL into a query tab without applying it.",
    validateTarget: validateDatabaseObjectTarget,
    execute: async (target, context) => {
      const connection = connectionById(target.connectionId!);
      if (!connection) {
        return notFound(context.actionId, "Data source", target.connectionId!);
      }
      const connectionError = await useConnectionStore
        .getState()
        .setActiveConnection(connection.id);
      if (connectionError) throw new Error(connectionError);
      const ddl = await loadTableDdl(
        {
          connectionId: connection.id,
          driver: connection.driver,
          databaseName: target.databaseName,
          schema: target.schemaName!,
          table: target.objectName!,
        },
        target.objectType,
      );
      useTabStore
        .getState()
        .findOrCreateObjectQueryTab(
          connection.id,
          target.schemaName,
          target.objectName!,
          target.objectType,
          ddl,
          `${target.objectName} DDL`,
        );
    },
  });

  registry.register({
    name: "editor.revealRange",
    description: "Activate a tab and reveal a one-based editor range.",
    validateTarget: (target) =>
      requireFields("projectId", "tabId", "range")(target) ||
      validateRange(target),
    execute: (target, context) => {
      const tab = useTabStore
        .getState()
        .tabs.find((candidate) => candidate.id === target.tabId);
      if (!tab) return notFound(context.actionId, "Tab", target.tabId!);
      useTabStore.getState().setActiveTab(tab.id);
      useWorkbenchLayoutStore.getState().setActiveToolWindow("editor");
      window.requestAnimationFrame(() =>
        requestEditorRangeReveal({
          tabId: tab.id,
          range: target.range!,
          focus: true,
        }),
      );
      const currentRevision = context.documentRevisionForTab(tab.id);
      if (
        context.issuedAgainst.documentRevision &&
        currentRevision !== context.issuedAgainst.documentRevision
      ) {
        return uiActionResult(
          context.actionId,
          "success",
          "REVEALED_STALE_DOCUMENT",
          "The range was revealed, but the document has changed since the attachment was created.",
        );
      }
    },
  });

  registry.register({
    name: "editor.previewPatch",
    description: "Preview a revision-bound editor patch.",
    stalePolicy: "document",
    execute: (_target, context) =>
      unsupported(context.actionId, "Patch preview is not available yet."),
  });

  registry.register({
    name: "editor.createQueryTab",
    description:
      "Create a query tab bound to an explicit data source and namespace.",
    validateTarget: requireFields("projectId"),
    execute: (target, context) => {
      if (target.connectionId && !connectionById(target.connectionId)) {
        return notFound(context.actionId, "Data source", target.connectionId);
      }
      useTabStore
        .getState()
        .createTab(
          "query",
          target.title?.trim() || "AI Query",
          target.sql || "",
          {
            connectionId: target.connectionId,
            databaseName: target.databaseName,
            schemaName: target.schemaName,
          },
        );
      useWorkbenchLayoutStore.getState().setActiveToolWindow("editor");
    },
  });

  registry.register({
    name: "results.reveal",
    description: "Activate a query tab and reveal one of its result sets.",
    validateTarget: requireFields("projectId", "tabId"),
    execute: (target, context) => {
      const tabStore = useTabStore.getState();
      const tab = tabStore.tabs.find(
        (candidate) => candidate.id === target.tabId,
      );
      if (!tab) return notFound(context.actionId, "Tab", target.tabId!);
      if (!tab.results?.length) {
        return notFound(
          context.actionId,
          "Result",
          target.resultId || target.tabId!,
        );
      }
      tabStore.setActiveTab(tab.id);
      tabStore.setActiveResultIndex(tab.id, target.resultIndex ?? 0);
      useWorkbenchLayoutStore.getState().setActiveToolWindow("results");
    },
  });

  registry.register({
    name: "plan.revealNode",
    description: "Reveal an Explain Plan node.",
    validateTarget: requireFields("projectId", "tabId", "planId", "nodeId"),
    execute: (target, context) => {
      const tabStore = useTabStore.getState();
      const tab = tabStore.tabs.find(
        (candidate) => candidate.id === target.tabId,
      );
      if (!tab) return notFound(context.actionId, "Tab", target.tabId!);
      if (!tab.explainPlan || tab.explainPlan.id !== target.planId) {
        return notFound(context.actionId, "Explain Plan", target.planId!);
      }
      if (!findExplainPlanNode(tab.explainPlan.root, target.nodeId!)) {
        return notFound(context.actionId, "Plan node", target.nodeId!);
      }
      tabStore.setActiveTab(tab.id);
      tabStore.setQueryOutputView(tab.id, "plan");
      useWorkbenchLayoutStore.getState().setActiveToolWindow("results");
      window.requestAnimationFrame(() =>
        requestExplainPlanNodeReveal({
          tabId: tab.id,
          planId: tab.explainPlan!.id,
          nodeId: target.nodeId!,
        }),
      );
    },
  });

  registry.register({
    name: "schemaDiff.revealChange",
    description: "Reveal one exact change in a schema diff artifact.",
    stalePolicy: "project",
    validateTarget: requireFields(
      "projectId",
      "tabId",
      "schemaDiffId",
      "schemaChangeId",
    ),
    execute: (target, context) => {
      const tabStore = useTabStore.getState();
      const tab = tabStore.tabs.find(
        (candidate) => candidate.id === target.tabId,
      );
      if (!tab) return notFound(context.actionId, "Tab", target.tabId!);
      const plan = tab.schemaDiffPlan;
      if (
        tab.type !== "schema_diff" ||
        !plan ||
        plan.id !== target.schemaDiffId
      ) {
        return notFound(
          context.actionId,
          "Schema diff",
          target.schemaDiffId!,
        );
      }
      if (
        !plan.changes.some(
          (change) => change.id === target.schemaChangeId,
        )
      ) {
        return notFound(
          context.actionId,
          "Schema change",
          target.schemaChangeId!,
        );
      }
      tabStore.setActiveTab(tab.id);
      tabStore.selectSchemaDiffChange(tab.id, target.schemaChangeId!);
      useWorkbenchLayoutStore.getState().setActiveToolWindow("editor");
    },
  });

  registry.register({
    name: "settings.open",
    description: "Open Settings without changing secret values.",
    execute: () => {
      window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_SETTINGS));
    },
  });

  registry.register({
    name: "task.reveal",
    description: "Reveal a durable background task.",
    execute: (_target, context) =>
      unsupported(
        context.actionId,
        "Durable agent tasks are not available yet.",
      ),
  });

  return registry;
}

function connectionById(connectionId: string) {
  return useConnectionStore
    .getState()
    .connections.find((connection) => connection.id === connectionId);
}

function requireFields(...fields: Array<keyof UiActionTarget>) {
  return (target: UiActionTarget) => {
    for (const field of fields) {
      const value = target[field];
      if (value === undefined || value === null || value === "") {
        return `${field} is required.`;
      }
    }
    return null;
  };
}

function validateDatabaseObjectTarget(target: UiActionTarget) {
  return requireFields(
    "projectId",
    "connectionId",
    "schemaName",
    "objectName",
  )(target);
}

function validateRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return "relativePath must remain inside the active project root.";
  }
  return null;
}

function validateRange(target: UiActionTarget) {
  const range = target.range!;
  const values = [
    range.startLine,
    range.startColumn,
    range.endLine,
    range.endColumn,
  ];
  if (values.some((value) => !Number.isInteger(value) || value < 1)) {
    return "Editor range coordinates must be positive one-based integers.";
  }
  if (
    range.endLine < range.startLine ||
    (range.endLine === range.startLine && range.endColumn < range.startColumn)
  ) {
    return "Editor range end must not precede its start.";
  }
  return null;
}

function notFound(actionId: string, targetType: string, identity: string) {
  return uiActionResult(
    actionId,
    "notFound",
    "TARGET_NOT_FOUND",
    `${targetType} not found: ${identity}`,
    "Refresh the workspace context and try again.",
  );
}

function unsupported(actionId: string, message: string) {
  return uiActionResult(actionId, "unsupported", "UNSUPPORTED_ACTION", message);
}
