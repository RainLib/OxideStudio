import {
  APP_EVENT_FORMAT_SQL,
  APP_EVENT_OPEN_DATABASE_SEARCH,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_RUN_QUERY,
} from "@/lib/actionEvents";
import { useEditorGroupStore } from "@/store/useEditorGroupStore";
import { useTabStore } from "@/store/useTabStore";
import type { WorkbenchAction } from "./contracts";
import { dispatchWorkbenchActionEvent } from "./events";

export function createQueryLifecycleActions(): WorkbenchAction[] {
  return [
    {
      id: "query.newConsole",
      title: "New Query Console",
      group: "Query",
      run: () => {
        useEditorGroupStore.getState().reset();
        useTabStore.getState().createTab("query", "New Query", "");
      },
    },
    {
      id: "query.reopenClosed",
      title: "Reopen Closed Tab",
      group: "Query",
      run: () => useTabStore.getState().reopenTab(),
    },
    {
      id: "query.closeTab",
      title: "Close Active Tab",
      group: "Query",
      run: () => {
        const { activeTabId, closeTab } = useTabStore.getState();
        if (activeTabId) closeTab(activeTabId);
      },
    },
    {
      id: "query.run",
      title: "Run Query",
      group: "Query",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_RUN_QUERY),
    },
    {
      id: "query.runCurrentStatement",
      title: "Run Current Statement",
      group: "Query",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_RUN_CURRENT),
    },
  ];
}

export function createQueryCommandActions(): WorkbenchAction[] {
  return [
    {
      id: "query.format",
      title: "Format Query",
      group: "Query",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_FORMAT_SQL),
    },
    {
      id: "query.searchDatabase",
      title: "Search Data in Current Database",
      group: "Query",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_OPEN_DATABASE_SEARCH),
    },
  ];
}
