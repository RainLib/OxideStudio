import {
  editorSelectionsEqual,
  editorViewSelectionsEqual,
  editorViewportsEqual,
} from "@/features/workspace-tabs/model/editorState";
import {
  normalizedDatabaseName,
  persistProjectSqlFileTargetForTab,
} from "@/features/workspace-tabs/model/tabIdentity";
import { documentTextRevision } from "@/lib/documentRevision";
import { applyEditorTextPatch } from "@/lib/editorPatch";
import type { Diagnostic } from "@/services/lsp/types";
import type { TabSlice } from "./types";

export const createEditorSlice: TabSlice<
  | "updateTabSql"
  | "setQueryLanguage"
  | "setElasticsearchVariables"
  | "setEditorSelection"
  | "setEditorViewport"
  | "previewEditorPatch"
  | "dismissEditorPatch"
  | "applyEditorPatchPreview"
  | "setLspDiagnostics"
  | "setTargetSchema"
  | "setTargetDatabase"
> = (set, get) => ({
  updateTabSql: (id: string, sql: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id && !tab.filePreview
          ? {
              ...tab,
              sql,
              explainPlan: tab.sql === sql ? tab.explainPlan : null,
              queryError: tab.sql === sql ? tab.queryError : null,
              queryOutputView:
                tab.sql === sql || !tab.explainPlan
                  ? tab.queryOutputView
                  : "results",
              isDirty:
                tab.fileRelativePath || tab.savedSqlFileId
                  ? tab.isDirty || tab.sql !== sql
                  : tab.isDirty,
              fileError:
                tab.fileRelativePath || tab.savedSqlFileId
                  ? null
                  : tab.fileError,
            }
          : tab,
      ),
    }));
  },

  setQueryLanguage: (id, queryLanguage) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, queryLanguage } : tab,
      ),
    }));
  },

  setElasticsearchVariables: (id, elasticsearchVariables) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, elasticsearchVariables } : tab,
      ),
    }));
  },

  setEditorSelection: (id, selection, viewSelection) => {
    set((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (
        !tab ||
        (editorSelectionsEqual(tab.editorSelection, selection) &&
          (viewSelection === undefined ||
            editorViewSelectionsEqual(tab.editorViewSelection, viewSelection)))
      ) {
        return state;
      }
      return {
        tabs: state.tabs.map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                editorSelection: selection,
                editorViewSelection:
                  viewSelection ?? candidate.editorViewSelection,
              }
            : candidate,
        ),
      };
    });
  },

  setEditorViewport: (id, viewport) => {
    set((state) => {
      const tab = state.tabs.find((candidate) => candidate.id === id);
      if (!tab || editorViewportsEqual(tab.editorViewport, viewport))
        return state;
      return {
        tabs: state.tabs.map((candidate) =>
          candidate.id === id
            ? { ...candidate, editorViewport: viewport }
            : candidate,
        ),
      };
    });
  },

  previewEditorPatch: (tabId, patch) => {
    set((state) => {
      const acceptsPatch = state.tabs.some(
        (tab) => tab.id === tabId && tab.type === "query" && !tab.filePreview,
      );
      if (!acceptsPatch) return {};
      return {
        activeTabId: tabId,
        tabs: state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, editorPatchPreview: patch } : tab,
        ),
      };
    });
  },

  dismissEditorPatch: (tabId, patchId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId && (!patchId || tab.editorPatchPreview?.id === patchId)
          ? { ...tab, editorPatchPreview: null }
          : tab,
      ),
    }));
  },

  applyEditorPatchPreview: (tabId, patchId) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (
      !tab ||
      !tab.editorPatchPreview ||
      tab.editorPatchPreview.id !== patchId
    ) {
      return {
        status: "notFound",
        message: "Patch preview is no longer available.",
      };
    }
    const patch = tab.editorPatchPreview;
    if (
      documentTextRevision(tab.fileRevision, tab.sql) !== patch.expectedRevision
    ) {
      return {
        status: "stale",
        message: "The editor document changed after this patch was proposed.",
      };
    }
    const result = applyEditorTextPatch(
      tab.sql,
      patch.range,
      patch.originalText,
      patch.replacement,
    );
    if (result.status !== "success") return result;
    get().updateTabSql(tabId, result.text);
    get().dismissEditorPatch(tabId, patchId);
    return result;
  },

  setLspDiagnostics: (id: string, diagnostics: Diagnostic[]) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, lspDiagnostics: diagnostics } : t,
      ),
    }));
  },

  setTargetSchema: (tabId, schema) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, targetSchema: schema } : t,
      ),
    }));
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (tab) persistProjectSqlFileTargetForTab(tab);
  },

  setTargetDatabase: (tabId, database) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, databaseName: normalizedDatabaseName(database) }
          : tab,
      ),
    }));
    const tab = get().tabs.find((candidate) => candidate.id === tabId);
    if (tab) persistProjectSqlFileTargetForTab(tab);
  },
});
