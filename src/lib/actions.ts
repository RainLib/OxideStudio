import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { settingsService } from "@/services/tauri/settings.service";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { saveEditorFileTab } from "@/lib/editorFileSave";
import { requestProjectFilesPanel } from "@/lib/projectFilesNavigation";
import {
  useEditorGroupStore,
  type EditorSplitDirection,
} from "@/store/useEditorGroupStore";
import {
  APP_EVENT_FORMAT_SQL,
  APP_EVENT_INSERT_LINE_BELOW,
  APP_EVENT_INLINE_COMPLETION_ACCEPT,
  APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
  APP_EVENT_INLINE_COMPLETION_HIDE,
  APP_EVENT_INLINE_COMPLETION_TRIGGER,
  APP_EVENT_OPEN_COMMAND_PALETTE,
  APP_EVENT_OPEN_DATABASE_SEARCH,
  APP_EVENT_OPEN_SETTINGS,
  APP_EVENT_RUN_CURRENT,
  APP_EVENT_RUN_QUERY,
} from "@/lib/actionEvents";

export * from "@/lib/actionEvents";

export type WorkbenchActionId =
  | "commandPalette.open"
  | "settings.open"
  | "settings.openJson"
  | "window.new"
  | "editor.splitLeft"
  | "editor.splitRight"
  | "editor.splitUp"
  | "editor.splitDown"
  | "query.newConsole"
  | "query.searchDatabase"
  | "query.reopenClosed"
  | "query.closeTab"
  | "query.run"
  | "query.runCurrentStatement"
  | "query.format"
  | "editor.insertLineBelow"
  | "editor.inlineCompletion.trigger"
  | "editor.inlineCompletion.accept"
  | "editor.inlineCompletion.acceptNextWord"
  | "editor.inlineCompletion.hide"
  | "file.save"
  | "workbench.toggleDatabaseExplorer"
  | "workbench.openProjectFiles"
  | "workbench.toggleSqlLibrary"
  | "workbench.toggleAssistant"
  | "workbench.toggleCommit"
  | "workbench.toggleVersionControl"
  | "workbench.toggleResults"
  | "workbench.focusEditor"
  | "workbench.focusDatabaseExplorer"
  | "workbench.focusAssistant"
  | "workbench.focusSqlLibrary"
  | "workbench.focusCommit"
  | "workbench.focusVersionControl"
  | "workbench.focusResults"
  | "workbench.moveActiveToolWindowLeft"
  | "workbench.moveActiveToolWindowRight"
  | "workbench.moveCommitLeft"
  | "workbench.moveCommitRight"
  | "workbench.moveVersionControlLeft"
  | "workbench.moveVersionControlRight"
  | "workbench.resizeActiveToolWindowLeft"
  | "workbench.resizeActiveToolWindowRight"
  | "workbench.resizeActiveToolWindowUp"
  | "workbench.resizeActiveToolWindowDown";

export type WorkbenchAction = {
  id: WorkbenchActionId;
  title: string;
  group: "Workbench" | "Editor" | "Query" | "File" | "Window" | "Settings";
  run: () => void | Promise<void>;
};

function splitActiveEditor(direction: EditorSplitDirection) {
  const { activeTabId, tabs } = useTabStore.getState();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTabId || activeTab?.type !== "query") return;
  useEditorGroupStore.getState().split(direction, activeTabId);
}

export function workbenchActions(): WorkbenchAction[] {
  return [
    {
      id: "commandPalette.open",
      title: "Open Command Palette",
      group: "Workbench",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE));
      },
    },
    {
      id: "settings.open",
      title: "Open Settings",
      group: "Settings",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_SETTINGS));
      },
    },
    {
      id: "settings.openJson",
      title: "Open Settings JSON",
      group: "Settings",
      run: async () => {
        const settings = useSettingsStore.getState().settings;
        await settingsService.saveAppSettings(settings);
        await openPath(await settingsService.getAppSettingsPath());
      },
    },
    {
      id: "window.new",
      title: "New Window",
      group: "Window",
      run: async () => {
        await invoke<string>("create_new_window");
      },
    },
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
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_RUN_QUERY));
      },
    },
    {
      id: "query.runCurrentStatement",
      title: "Run Current Statement",
      group: "Query",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_RUN_CURRENT));
      },
    },
    {
      id: "file.save",
      title: "Save Editor File",
      group: "File",
      run: async () => {
        await saveEditorFileTab();
      },
    },
    ...(
      [
        ["editor.splitLeft", "Split Editor Left", "left"],
        ["editor.splitRight", "Split Editor Right", "right"],
        ["editor.splitUp", "Split Editor Up", "up"],
        ["editor.splitDown", "Split Editor Down", "down"],
      ] as const
    ).map(([id, title, direction]) => ({
      id,
      title,
      group: "Editor" as const,
      run: () => splitActiveEditor(direction),
    })),
    {
      id: "query.format",
      title: "Format Query",
      group: "Query",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_FORMAT_SQL));
      },
    },
    {
      id: "query.searchDatabase",
      title: "Search Data in Current Database",
      group: "Query",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_DATABASE_SEARCH));
      },
    },
    {
      id: "editor.insertLineBelow",
      title: "Insert Line Below",
      group: "Editor",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_INSERT_LINE_BELOW));
      },
    },
    {
      id: "workbench.toggleDatabaseExplorer",
      title: "Toggle Database Explorer",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().toggleToolWindow("databaseExplorer"),
    },
    {
      id: "workbench.openProjectFiles",
      title: "Open Project Files",
      group: "File",
      run: () => {
        requestProjectFilesPanel();
      },
    },
    {
      id: "editor.inlineCompletion.trigger",
      title: "Trigger Inline Completion",
      group: "Editor",
      run: () => {
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_INLINE_COMPLETION_TRIGGER),
        );
      },
    },
    {
      id: "editor.inlineCompletion.accept",
      title: "Accept Inline Completion",
      group: "Editor",
      run: () => {
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_INLINE_COMPLETION_ACCEPT),
        );
      },
    },
    {
      id: "editor.inlineCompletion.acceptNextWord",
      title: "Accept Next Inline Completion Word",
      group: "Editor",
      run: () => {
        window.dispatchEvent(
          new CustomEvent(APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD),
        );
      },
    },
    {
      id: "editor.inlineCompletion.hide",
      title: "Hide Inline Completion",
      group: "Editor",
      run: () => {
        window.dispatchEvent(new CustomEvent(APP_EVENT_INLINE_COMPLETION_HIDE));
      },
    },
    {
      id: "workbench.toggleAssistant",
      title: "Toggle AI Assistant",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().toggleToolWindow("assistant"),
    },
    {
      id: "workbench.toggleSqlLibrary",
      title: "Toggle SQL Library",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().toggleToolWindow("sqlLibrary"),
    },
    {
      id: "workbench.toggleCommit",
      title: "Toggle Commit",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().toggleToolWindow("commit"),
    },
    {
      id: "workbench.toggleVersionControl",
      title: "Toggle Version Control",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().toggleToolWindow("versionControl"),
    },
    {
      id: "workbench.toggleResults",
      title: "Toggle Results",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().toggleToolWindow("results"),
    },
    {
      id: "workbench.focusEditor",
      title: "Focus Editor",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().setActiveToolWindow("editor"),
    },
    {
      id: "workbench.focusDatabaseExplorer",
      title: "Focus Database Explorer",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore
          .getState()
          .setActiveToolWindow("databaseExplorer"),
    },
    {
      id: "workbench.focusAssistant",
      title: "Focus AI Assistant",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().setActiveToolWindow("assistant"),
    },
    {
      id: "workbench.focusSqlLibrary",
      title: "Focus SQL Library",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().setActiveToolWindow("sqlLibrary"),
    },
    {
      id: "workbench.focusCommit",
      title: "Focus Commit",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().setActiveToolWindow("commit"),
    },
    {
      id: "workbench.focusVersionControl",
      title: "Focus Version Control",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore
          .getState()
          .setActiveToolWindow("versionControl"),
    },
    {
      id: "workbench.focusResults",
      title: "Focus Results",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().setActiveToolWindow("results"),
    },
    {
      id: "workbench.moveActiveToolWindowLeft",
      title: "Move Active Tool Window Left",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().moveActiveToolWindow("left"),
    },
    {
      id: "workbench.moveActiveToolWindowRight",
      title: "Move Active Tool Window Right",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().moveActiveToolWindow("right"),
    },
    ...(
      [
        ["workbench.moveCommitLeft", "Move Commit to Left", "commit", "left"],
        ["workbench.moveCommitRight", "Move Commit to Right", "commit", "right"],
        ["workbench.moveVersionControlLeft", "Move Version Control to Left", "versionControl", "left"],
        ["workbench.moveVersionControlRight", "Move Version Control to Right", "versionControl", "right"],
      ] as const
    ).map(([id, title, toolWindow, side]) => ({
      id,
      title,
      group: "Workbench" as const,
      run: () => useWorkbenchLayoutStore.getState().moveToolWindow(toolWindow, side),
    })),
    {
      id: "workbench.resizeActiveToolWindowLeft",
      title: "Resize Active Tool Window Left",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().resizeActiveToolWindow("left"),
    },
    {
      id: "workbench.resizeActiveToolWindowRight",
      title: "Resize Active Tool Window Right",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().resizeActiveToolWindow("right"),
    },
    {
      id: "workbench.resizeActiveToolWindowUp",
      title: "Resize Active Tool Window Up",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().resizeActiveToolWindow("up"),
    },
    {
      id: "workbench.resizeActiveToolWindowDown",
      title: "Resize Active Tool Window Down",
      group: "Workbench",
      run: () =>
        useWorkbenchLayoutStore.getState().resizeActiveToolWindow("down"),
    },
  ];
}

export function findWorkbenchAction(id: string) {
  return workbenchActions().find((action) => action.id === id);
}
