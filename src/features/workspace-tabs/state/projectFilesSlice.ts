import {
  fileNameFromPath,
  normalizedDatabaseName,
  persistProjectSqlFileTargetForTab,
} from "@/features/workspace-tabs/model/tabIdentity";
import { releaseTabRuntimeResources } from "@/features/workspace-tabs/model/tabLifecycle";
import {
  ProjectFileImagePreview,
  TabData,
} from "@/features/workspace-tabs/model/types";
import {
  forgetProjectSqlFileTargets,
  isProjectSqlFile,
  rememberProjectSqlFileTarget,
  renameProjectSqlFileTargets,
  resolveProjectSqlFileTarget,
} from "@/lib/projectSqlFileTarget";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import type { TabSlice } from "./types";

export const createProjectFilesSlice: TabSlice<
  | "openProjectFileTab"
  | "openProjectFilePreviewTab"
  | "openAgentFileDiffTab"
  | "openGitFileDiffTab"
  | "syncAgentFileDiffPreview"
  | "dismissAgentFileDiffPreview"
  | "markProjectFileSaved"
  | "renameProjectFileTabs"
  | "discardProjectFileTabs"
> = (set, get) => ({
  openProjectFileTab: (
    projectId,
    relativePath,
    content,
    revision,
    rootPath,
  ) => {
    const existing = get().tabs.find(
      (tab) =>
        !tab.agentFileDiffPreview &&
        !tab.gitFileDiffPreview &&
        tab.fileProjectId === projectId &&
        tab.fileRelativePath === relativePath &&
        (!rootPath || !tab.fileRootPath || tab.fileRootPath === rootPath),
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return existing.id;
    }

    const connectionState = useConnectionStore.getState();
    const sqlFile = isProjectSqlFile(relativePath);
    const savedTarget = sqlFile
      ? resolveProjectSqlFileTarget(
          projectId,
          relativePath,
          connectionState.isLoading
            ? undefined
            : (connectionId) =>
                connectionState.connections.some(
                  (connection) => connection.id === connectionId,
                ),
        )
      : null;
    const activeConnection = connectionState.connections.find(
      (connection) => connection.id === connectionState.activeConnectionId,
    );
    const initialTarget = sqlFile
      ? savedTarget ||
        (activeConnection
          ? {
              connectionId: activeConnection.id,
              databaseName: activeConnection.database,
              schemaName: useSchemaStore.getState().currentSchema || undefined,
            }
          : null)
      : null;

    if (initialTarget) {
      rememberProjectSqlFileTarget(projectId, relativePath, initialTarget);
    }

    return get().createTab("query", fileNameFromPath(relativePath), content, {
      connectionId: initialTarget?.connectionId,
      databaseName: normalizedDatabaseName(initialTarget?.databaseName),
      schemaName: initialTarget?.schemaName,
      targetSchema: initialTarget?.schemaName,
      fileProjectId: projectId,
      fileRootPath: rootPath || undefined,
      fileRelativePath: relativePath,
      fileRevision: revision,
      isDirty: false,
    });
  },

  openProjectFilePreviewTab: (
    projectId,
    relativePath,
    mediaType,
    dataBase64,
    revision,
    size,
    rootPath,
  ) => {
    const existing = get().tabs.find(
      (tab) =>
        !tab.agentFileDiffPreview &&
        !tab.gitFileDiffPreview &&
        tab.fileProjectId === projectId &&
        tab.fileRelativePath === relativePath &&
        (!rootPath || !tab.fileRootPath || tab.fileRootPath === rootPath),
    );
    const filePreview: ProjectFileImagePreview = {
      kind: "image",
      mediaType,
      dataUrl: `data:${mediaType};base64,${dataBase64}`,
      size,
    };

    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                sql: "",
                fileRevision: revision,
                filePreview,
                isDirty: false,
                fileError: null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }

    return get().createTab("query", fileNameFromPath(relativePath), "", {
      fileProjectId: projectId,
      fileRootPath: rootPath || undefined,
      fileRelativePath: relativePath,
      fileRevision: revision,
      filePreview,
      isDirty: false,
    });
  },

  openAgentFileDiffTab: (preview) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.agentFileDiffPreview?.turnId === preview.turnId &&
        tab.agentFileDiffPreview.callId === preview.callId,
    );
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                sql: preview.originalContent,
                fileRevision: preview.baseRevision || undefined,
                agentFileDiffPreview: preview,
                fileError: null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }
    return get().createTab(
      "query",
      `${fileNameFromPath(preview.relativePath)} (Diff)`,
      preview.originalContent,
      {
        fileProjectId: preview.projectId,
        fileRootPath: preview.expectedRoot || undefined,
        fileRelativePath: preview.relativePath,
        fileRevision: preview.baseRevision || undefined,
        isDirty: false,
        agentFileDiffPreview: preview,
      },
    );
  },

  openGitFileDiffTab: (preview) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.gitFileDiffPreview?.projectId === preview.projectId &&
        tab.gitFileDiffPreview.relativePath === preview.relativePath &&
        tab.gitFileDiffPreview.scope === preview.scope,
    );
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                sql: preview.originalContent,
                gitFileDiffPreview: preview,
                fileError: null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }
    return get().createTab(
      "query",
      `${fileNameFromPath(preview.relativePath)} (Git Diff)`,
      preview.originalContent,
      {
        fileProjectId: preview.projectId,
        fileRootPath: preview.expectedRoot || undefined,
        fileRelativePath: preview.relativePath,
        isDirty: false,
        gitFileDiffPreview: preview,
      },
    );
  },

  syncAgentFileDiffPreview: (preview) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.agentFileDiffPreview?.turnId === preview.turnId &&
        tab.agentFileDiffPreview.callId === preview.callId
          ? {
              ...tab,
              sql: preview.originalContent,
              fileRevision: preview.baseRevision || undefined,
              agentFileDiffPreview: preview,
              fileError: preview.error || null,
            }
          : tab,
      ),
    }));
  },

  dismissAgentFileDiffPreview: (turnId, callId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.agentFileDiffPreview?.turnId === turnId &&
        tab.agentFileDiffPreview.callId === callId
          ? { ...tab, agentFileDiffPreview: null }
          : tab,
      ),
    }));
  },

  markProjectFileSaved: (id, revision, savedContent) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              fileRevision: revision,
              isDirty:
                savedContent === undefined ? false : tab.sql !== savedContent,
              fileError: null,
            }
          : tab,
      ),
    }));
  },

  renameProjectFileTabs: (projectId, oldRelativePath, newRelativePath) => {
    renameProjectSqlFileTargets(projectId, oldRelativePath, newRelativePath);
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (
          tab.fileProjectId !== projectId ||
          !tab.fileRelativePath ||
          (tab.fileRelativePath !== oldRelativePath &&
            !tab.fileRelativePath.startsWith(`${oldRelativePath}/`))
        ) {
          return tab;
        }
        const nextPath = `${newRelativePath}${tab.fileRelativePath.slice(oldRelativePath.length)}`;
        return {
          ...tab,
          fileRelativePath: nextPath,
          title: fileNameFromPath(nextPath),
        };
      }),
    }));
    for (const tab of get().tabs) {
      if (
        tab.fileProjectId === projectId &&
        tab.fileRelativePath &&
        (tab.fileRelativePath === newRelativePath ||
          tab.fileRelativePath.startsWith(`${newRelativePath}/`))
      ) {
        persistProjectSqlFileTargetForTab(tab);
      }
    }
  },

  discardProjectFileTabs: (projectId, relativePath, forgetTargets = true) => {
    if (forgetTargets) {
      forgetProjectSqlFileTargets(projectId, relativePath);
    }
    let discarded: TabData[] = [];
    set((state) => {
      const shouldDiscard = (tab: TabData) =>
        tab.fileProjectId === projectId &&
        Boolean(tab.fileRelativePath) &&
        (!relativePath ||
          tab.fileRelativePath === relativePath ||
          tab.fileRelativePath!.startsWith(`${relativePath}/`));
      const discardedIds = new Set(
        state.tabs.filter(shouldDiscard).map((tab) => tab.id),
      );
      if (discardedIds.size === 0) return state;
      discarded = state.tabs.filter((tab) => discardedIds.has(tab.id));

      const tabs = state.tabs.filter((tab) => !discardedIds.has(tab.id));
      const activeTabId =
        state.activeTabId && discardedIds.has(state.activeTabId)
          ? tabs[tabs.length - 1]?.id || null
          : state.activeTabId;
      return {
        tabs,
        activeTabId,
        closedTabsStack: state.closedTabsStack.filter(
          (tab) => !shouldDiscard(tab),
        ),
      };
    });
    releaseTabRuntimeResources(discarded);
  },
});
