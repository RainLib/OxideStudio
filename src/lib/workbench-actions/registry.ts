import type { WorkbenchAction } from "./contracts";
import { createEditorLineAction, createEditorSplitActions, createInlineCompletionActions } from "./editor";
import { createFileSaveAction, createOpenFileQueryAction, createOpenProjectFilesAction } from "./files";
import { createGlobalWorkbenchActions } from "./global";
import { createQueryCommandActions, createQueryLifecycleActions } from "./query";
import {
  createDatabaseExplorerToggleAction,
  createToolWindowActions,
  createToolWindowFocusAndLayoutActions,
  createToolWindowManagementActions,
} from "./toolWindows";

/** Build the command palette and shortcut registry in its established display order. */
export function workbenchActions(): WorkbenchAction[] {
  return [
    ...createGlobalWorkbenchActions(),
    ...createQueryLifecycleActions(),
    createFileSaveAction(),
    createOpenFileQueryAction(),
    ...createEditorSplitActions(),
    ...createQueryCommandActions(),
    createEditorLineAction(),
    createDatabaseExplorerToggleAction(),
    createOpenProjectFilesAction(),
    ...createInlineCompletionActions(),
    ...createToolWindowActions(),
    ...createToolWindowFocusAndLayoutActions(),
    ...createToolWindowManagementActions(),
  ];
}

export function findWorkbenchAction(id: string): WorkbenchAction | undefined {
  return workbenchActions().find((action) => action.id === id);
}
