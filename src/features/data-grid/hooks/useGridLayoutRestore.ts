import {
  gridLayoutKey,
  loadGridLayout,
  normalizeGridLayout,
} from "@/features/data-grid/model/gridLayoutRepository";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { TabState } from "@/features/workspace-tabs/model/types";
import { resultColumnGridId } from "@/lib/gridColumns";
import type { QueryResult } from "@/services/tauri/types/query";
import { useRef } from "react";

import { useEffect, useMemo } from "react";

interface GridLayoutRestoreOptions {
  isTransposed: boolean;
  result: QueryResult | undefined;
  overrideColumns: { name: string; type?: string | undefined }[] | undefined;
  activeTab: GridTabSnapshot | null;
  restoreColumnLayout: TabState["restoreColumnLayout"];
}

export function useGridLayoutRestore({
  isTransposed,
  result,
  overrideColumns,
  activeTab,
  restoreColumnLayout,
}: GridLayoutRestoreOptions) {
  const restoredLayoutRef = useRef<string | null>(null);

  const layoutColumnIds = useMemo(() => {
    if (isTransposed) return [];
    if (result?.columns?.length) {
      return result.columns.map((_column, index) =>
        resultColumnGridId(result.columns, index),
      );
    }
    return overrideColumns?.map((column) => column.name) || [];
  }, [isTransposed, overrideColumns, result?.columns]);

  useEffect(() => {
    if (!activeTab || layoutColumnIds.length === 0 || isTransposed) return;
    const scope = {
      type: activeTab.type,
      connectionId: activeTab.connectionId,
      databaseName: activeTab.databaseName,
      schemaName: activeTab.schemaName,
      tableName: activeTab.tableName,
      queryLanguage: activeTab.queryLanguage,
      sql: activeTab.resultSql,
    };
    const layoutKey = gridLayoutKey(scope);
    if (!layoutKey) return;
    // Include the ephemeral tab id: closing and reopening the same object
    // must hydrate the new tab from its durable layout rather than inheriting
    // the previous tab's in-memory "already restored" marker.
    const restoreKey = `${activeTab.id}:${layoutKey}:${layoutColumnIds.join("\\u0001")}`;
    if (restoredLayoutRef.current === restoreKey) return;

    restoredLayoutRef.current = restoreKey;
    restoreColumnLayout(
      activeTab.id,
      loadGridLayout(scope, layoutColumnIds) ||
        normalizeGridLayout({}, layoutColumnIds),
    );
  }, [activeTab, isTransposed, layoutColumnIds, restoreColumnLayout]);
}
