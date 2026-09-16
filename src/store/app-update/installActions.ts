import { useTaskStore } from "@/store/useTaskStore";
import type { AppUpdateGet, AppUpdateSet } from "./contracts";
import { activeUpdateBlockingTaskCount, describeUpdateError } from "./policy";

export function createUpdateInstallActions(set: AppUpdateSet, get: AppUpdateGet) {
  return {
    installAndRestart: async () => {
      if (get().status !== "downloaded") return;
      const activeTaskCount = activeUpdateBlockingTaskCount(
        useTaskStore.getState().tasks,
      );
      if (activeTaskCount > 0) {
        set({
          error: `Finish or cancel ${activeTaskCount} active background ${activeTaskCount === 1 ? "task" : "tasks"} before installing the update.`,
        });
        return;
      }

      set({ status: "installing", error: null });
      try {
        const { installAppUpdateAndRestart } =
          await import("@/services/appUpdateService");
        await installAppUpdateAndRestart();
      } catch (error) {
        set({ status: "downloaded", error: describeUpdateError(error) });
      }
    },
  };
}
