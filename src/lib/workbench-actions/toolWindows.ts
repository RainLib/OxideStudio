import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import type { WorkbenchAction } from "./contracts";

export function createDatabaseExplorerToggleAction(): WorkbenchAction {
  return {
    id: "workbench.toggleDatabaseExplorer",
    title: "Toggle Database Explorer",
    group: "Workbench",
    run: () =>
      useWorkbenchLayoutStore.getState().toggleToolWindow("databaseExplorer"),
  };
}

export function createToolWindowActions(): WorkbenchAction[] {
  return (
    [
      ["workbench.toggleAssistant", "Toggle AI Assistant", "assistant"],
      ["workbench.toggleSqlLibrary", "Toggle SQL Library", "sqlLibrary"],
      ["workbench.toggleCommit", "Toggle Commit", "commit"],
      ["workbench.toggleVersionControl", "Toggle Version Control", "versionControl"],
      ["workbench.toggleResults", "Toggle Results", "results"],
    ] as const
  ).map(([id, title, toolWindow]) => ({
    id,
    title,
    group: "Workbench" as const,
    run: () => useWorkbenchLayoutStore.getState().toggleToolWindow(toolWindow),
  })) as WorkbenchAction[];
}

export function createToolWindowFocusAndLayoutActions(): WorkbenchAction[] {
  return (
    [
      ["workbench.focusEditor", "Focus Editor", "editor"],
      ["workbench.focusDatabaseExplorer", "Focus Database Explorer", "databaseExplorer"],
      ["workbench.focusAssistant", "Focus AI Assistant", "assistant"],
      ["workbench.focusSqlLibrary", "Focus SQL Library", "sqlLibrary"],
      ["workbench.focusCommit", "Focus Commit", "commit"],
      ["workbench.focusVersionControl", "Focus Version Control", "versionControl"],
      ["workbench.focusResults", "Focus Results", "results"],
    ] as const
  ).map(([id, title, toolWindow]) => ({
    id,
    title,
    group: "Workbench" as const,
    run: () => useWorkbenchLayoutStore.getState().setActiveToolWindow(toolWindow),
  })) as WorkbenchAction[];
}

export function createToolWindowManagementActions(): WorkbenchAction[] {
  return [
    {
      id: "workbench.hideActiveToolWindow",
      title: "Hide Active Tool Window",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().hideActiveToolWindow(),
    },
    {
      id: "workbench.toggleAllToolWindows",
      title: "Hide or Restore All Tool Windows",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().toggleAllToolWindows(),
    },
    {
      id: "workbench.jumpToLastToolWindow",
      title: "Jump to Last Tool Window",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().jumpToLastToolWindow(),
    },
    {
      id: "workbench.moveActiveToolWindowLeft",
      title: "Move Active Tool Window Left",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().moveActiveToolWindow("left"),
    },
    {
      id: "workbench.moveActiveToolWindowRight",
      title: "Move Active Tool Window Right",
      group: "Workbench",
      run: () => useWorkbenchLayoutStore.getState().moveActiveToolWindow("right"),
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
    ...(
      [
        ["workbench.resizeActiveToolWindowLeft", "Resize Active Tool Window Left", "left"],
        ["workbench.resizeActiveToolWindowRight", "Resize Active Tool Window Right", "right"],
        ["workbench.resizeActiveToolWindowUp", "Resize Active Tool Window Up", "up"],
        ["workbench.resizeActiveToolWindowDown", "Resize Active Tool Window Down", "down"],
      ] as const
    ).map(([id, title, direction]) => ({
      id,
      title,
      group: "Workbench" as const,
      run: () =>
        useWorkbenchLayoutStore.getState().resizeActiveToolWindow(direction),
    })),
  ];
}
