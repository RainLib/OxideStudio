import { dataCompareSourceFromTab } from "@/features/workspace-tabs/model/dataCompare";
import {
  normalizeDiagramAreaHistory,
  normalizeDiagramCanvasHistory,
} from "@/features/workspace-tabs/model/diagramState";
import { TabData } from "@/features/workspace-tabs/model/types";
import { createSchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import { v4 as uuidv4 } from "uuid";
import type { TabSlice } from "./types";

export const createSchemaToolsSlice: TabSlice<
  | "openSchemaDiffTab"
  | "selectSchemaDiffChange"
  | "openSchemaDiagramTab"
  | "selectSchemaDiagramRelation"
  | "setSchemaDiagramCanvasHistory"
  | "selectSchemaDiagramArea"
  | "selectSchemaDiagramRelations"
  | "openDataCompareTab"
  | "openDataCompareSourcesTab"
> = (set, get) => ({
  openSchemaDiffTab: (plan, source, target) => {
    const existing = get().tabs.find(
      (tab) => tab.type === "schema_diff" && tab.schemaDiffPlan?.id === plan.id,
    );
    const title = `Schema Diff · ${plan.targetSchemaName}`;
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                title,
                schemaDiffPlan: plan,
                schemaDiffSource: source,
                schemaDiffTarget: target,
                selectedSchemaChangeId: plan.changes[0]?.id || null,
              }
            : tab,
        ),
      }));
      return existing.id;
    }

    const tab: TabData = {
      id: uuidv4(),
      title,
      type: "schema_diff",
      createdAt: Date.now(),
      sql: "",
      connectionId: plan.targetConnectionId,
      databaseName: plan.targetDatabaseName || undefined,
      schemaName: plan.targetSchemaName,
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      schemaDiffPlan: plan,
      schemaDiffSource: source,
      schemaDiffTarget: target,
      selectedSchemaChangeId: plan.changes[0]?.id || null,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  selectSchemaDiffChange: (tabId, changeId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, selectedSchemaChangeId: changeId } : tab,
      ),
    }));
  },

  openSchemaDiagramTab: (snapshot) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "schema_diagram" &&
        tab.connectionId === snapshot.connectionId &&
        tab.databaseName === (snapshot.databaseName || undefined) &&
        tab.schemaName === snapshot.schemaName,
    );
    const title = `Diagram · ${snapshot.schemaName}`;
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                title,
                schemaDiagramSnapshot: snapshot,
                selectedDiagramRelationName:
                  tab.selectedDiagramRelationName &&
                  snapshot.relations.some(
                    (relation) =>
                      relation.name === tab.selectedDiagramRelationName,
                  )
                    ? tab.selectedDiagramRelationName
                    : snapshot.relations[0]?.name || null,
                schemaDiagramCanvasHistory: normalizeDiagramCanvasHistory(
                  tab.schemaDiagramCanvasHistory,
                  tab.schemaDiagramAreaHistory,
                  tab.schemaDiagramNotes,
                  snapshot,
                ),
                schemaDiagramAreaHistory: normalizeDiagramAreaHistory(
                  tab.schemaDiagramAreaHistory,
                  snapshot,
                ),
                schemaDiagramNotes: tab.schemaDiagramNotes || [],
                selectedDiagramRelationNames: (
                  tab.selectedDiagramRelationNames || []
                ).filter((name) =>
                  snapshot.relations.some((relation) => relation.name === name),
                ),
              }
            : tab,
        ),
      }));
      return existing.id;
    }

    const tab: TabData = {
      id: uuidv4(),
      title,
      type: "schema_diagram",
      createdAt: Date.now(),
      sql: "",
      connectionId: snapshot.connectionId,
      databaseName: snapshot.databaseName || undefined,
      schemaName: snapshot.schemaName,
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      schemaDiagramSnapshot: snapshot,
      selectedDiagramRelationName: snapshot.relations[0]?.name || null,
      schemaDiagramCanvasHistory: createSchemaDiagramCanvasHistory(),
      schemaDiagramAreaHistory: { past: [], present: [], future: [] },
      schemaDiagramNotes: [],
      selectedDiagramAreaId: null,
      selectedDiagramRelationNames: snapshot.relations[0]?.name
        ? [snapshot.relations[0].name]
        : [],
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },

  selectSchemaDiagramRelation: (tabId, relationName) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, selectedDiagramRelationName: relationName }
          : tab,
      ),
    }));
  },

  setSchemaDiagramCanvasHistory: (tabId, history) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              schemaDiagramCanvasHistory: history,
              schemaDiagramAreaHistory: {
                past: [],
                present: history.present.areas,
                future: [],
              },
              schemaDiagramNotes: history.present.notes,
            }
          : tab,
      ),
    }));
  },

  selectSchemaDiagramArea: (tabId, areaId) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, selectedDiagramAreaId: areaId } : tab,
      ),
    }));
  },

  selectSchemaDiagramRelations: (tabId, relationNames) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              selectedDiagramRelationNames: [...new Set(relationNames)],
            }
          : tab,
      ),
    }));
  },

  openDataCompareTab: (leftTabId, rightTabId) => {
    if (leftTabId === rightTabId) return null;
    const leftTab = get().tabs.find((tab) => tab.id === leftTabId);
    const rightTab = get().tabs.find((tab) => tab.id === rightTabId);
    if (!leftTab || !rightTab) return null;
    const capturedAt = Date.now();
    const left = dataCompareSourceFromTab(leftTab, capturedAt);
    const right = dataCompareSourceFromTab(rightTab, capturedAt);
    if (!left || !right) return null;

    return get().openDataCompareSourcesTab(left, right);
  },

  openDataCompareSourcesTab: (left, right) => {
    if (
      left.tabId === right.tabId ||
      left.columns.length === 0 ||
      right.columns.length === 0
    ) {
      return null;
    }

    const title = `Compare · ${left.label} ↔ ${right.label}`;
    const existing = get().tabs.find(
      (tab) =>
        tab.type === "data_compare" &&
        tab.dataCompareLeft?.tabId === left.tabId &&
        tab.dataCompareRight?.tabId === right.tabId,
    );
    if (existing) {
      set((state) => ({
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? { ...tab, title, dataCompareLeft: left, dataCompareRight: right }
            : tab,
        ),
      }));
      return existing.id;
    }

    const tab: TabData = {
      id: uuidv4(),
      title,
      type: "data_compare",
      createdAt: Date.now(),
      sql: "",
      results: null,
      isExecuting: false,
      error: null,
      isPinned: false,
      dataCompareLeft: left,
      dataCompareRight: right,
    };
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab.id;
  },
});
