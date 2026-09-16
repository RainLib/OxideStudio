import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import type { TabData, TabType } from "@/features/workspace-tabs/model/types";
import type { QueryHistoryItem } from "@/lib/queryHistory";
import {
  queryHistoryDisplayTitle,
  queryHistoryForScope,
} from "@/lib/queryHistory";
import { cn } from "@/lib/utils";
import { Clock3, Code2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";

interface UseExplorerHistoryMenuContext {
  createTab: (
    type?: TabType | undefined,
    title?: string | undefined,
    initialSql?: string | undefined,
    metadata?:
      | Partial<
          Pick<
            TabData,
            | "connectionId"
            | "databaseName"
            | "tableName"
            | "schemaName"
            | "objectType"
            | "queryLanguage"
            | "elasticsearchVariables"
            | "filters"
            | "fileProjectId"
            | "savedSqlProjectId"
            | "savedSqlFileId"
            | "fileRootPath"
            | "fileRelativePath"
            | "fileRevision"
            | "filePreview"
            | "isDirty"
            | "targetSchema"
            | "agentFileDiffPreview"
            | "gitFileDiffPreview"
          >
        >
      | undefined,
  ) => string;
  queryHistory: QueryHistoryItem[];
}

export function useExplorerHistoryMenu({
  createTab,
  queryHistory,
}: UseExplorerHistoryMenuContext) {
  const sqlHistoryMenuCache = useMemo(
    () => new Map<string, ReactNode>(),
    [createTab, queryHistory],
  );

  const openHistoryInQueryConsole = (item: QueryHistoryItem) => {
    createTab(
      "query",
      `History \u00b7 ${queryHistoryDisplayTitle(item, 38)}`,
      item.sql,
      {
        connectionId: item.connectionId || undefined,
        databaseName: item.databaseName || undefined,
        schemaName: item.schemaName || undefined,
        targetSchema: item.schemaName || undefined,
      },
    );
  };

  const renderSqlHistorySubmenu = (scope: {
    connectionId: string;
    databaseName?: string | null;
    schemaName?: string | null;
  }) => {
    const cacheKey = [
      scope.connectionId,
      scope.databaseName === undefined ? "*" : (scope.databaseName ?? ""),
      scope.schemaName === undefined ? "*" : (scope.schemaName ?? ""),
    ].join("\u0000");
    if (sqlHistoryMenuCache.has(cacheKey)) {
      return sqlHistoryMenuCache.get(cacheKey) ?? null;
    }
    const items = queryHistoryForScope(queryHistory, scope);
    if (items.length === 0) {
      sqlHistoryMenuCache.set(cacheKey, null);
      return null;
    }

    const menu = (
      <ContextMenuSub>
        <ContextMenuSubTrigger className={menuSubClass}>
          <Clock3 className="mr-2 h-3.5 w-3.5" />
          Recent SQL
        </ContextMenuSubTrigger>
        <ContextMenuSubContent
          className={cn(menuContentClass, "max-w-[360px]")}
        >
          {items.map((item) => (
            <ContextMenuItem
              key={item.id}
              className={cn(menuItemClass, "min-w-0")}
              title={item.sql}
              onClick={() => openHistoryInQueryConsole(item)}
            >
              <Code2 className="mr-2 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                {queryHistoryDisplayTitle(item)}
              </span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
    sqlHistoryMenuCache.set(cacheKey, menu);
    return menu;
  };

  return { renderSqlHistorySubmenu };
}
