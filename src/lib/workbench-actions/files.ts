import { saveEditorFileTab } from "@/lib/editorFileSave";
import { requestProjectFilesPanel } from "@/lib/projectFilesNavigation";
import type { WorkbenchAction } from "./contracts";

export function createFileSaveAction(): WorkbenchAction {
  return {
    id: "file.save",
    title: "Save Editor File",
    group: "File",
    run: async () => {
      await saveEditorFileTab();
    },
  };
}

export function createOpenProjectFilesAction(): WorkbenchAction {
  return {
    id: "workbench.openProjectFiles",
    title: "Open Project Files",
    group: "File",
    run: () => {
      requestProjectFilesPanel();
    },
  };
}
