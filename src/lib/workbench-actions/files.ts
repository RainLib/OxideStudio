import { saveEditorFileTab } from "@/lib/editorFileSave";
import { requestProjectFilesPanel } from "@/lib/projectFilesNavigation";
import type { WorkbenchAction } from "./contracts";
import { resolveAppLocale, translate } from "@/i18n";
import { useSettingsStore } from "@/store/useSettingsStore";

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

export function createOpenFileQueryAction(): WorkbenchAction {
  return {
    id: "file.queryData",
    title: translate(resolveAppLocale(useSettingsStore.getState().settings.appearance.locale), "fileQuery.openAction"),
    group: "File",
    run: async () => {
      const [{ useFileQueryStore }, { useProjectStore }] = await Promise.all([
        import("@/features/file-query/store"),
        import("@/store/useProjectStore"),
      ]);
      await useFileQueryStore.getState().show({ kind: "picker", projectId: useProjectStore.getState().activeProjectId });
    },
  };
}
