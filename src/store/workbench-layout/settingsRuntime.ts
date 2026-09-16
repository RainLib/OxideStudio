import { useSettingsStore } from "@/store/useSettingsStore";
import type {
  WorkbenchLayoutSettings,
  WorkbenchSettings,
} from "./contracts";

export function currentWorkbenchSettings(): WorkbenchSettings {
  return useSettingsStore.getState().settings.workbench;
}

export function saveWorkbenchSettings(workbench: WorkbenchSettings) {
  void useSettingsStore.getState().updateSettings({ workbench });
}

export function updateWorkbenchLayout(patch: Partial<WorkbenchLayoutSettings>) {
  const workbench = currentWorkbenchSettings();
  saveWorkbenchSettings({
    ...workbench,
    layout: {
      ...workbench.layout,
      ...patch,
    },
  });
}
