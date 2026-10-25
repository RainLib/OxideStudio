import { useTaskStore } from "@/store/useTaskStore";
import type { AppUpdateGet, AppUpdateSet } from "./contracts";
import { activeUpdateBlockingTaskCount, describeUpdateError } from "./policy";

export function createUpdateInstallActions(set: AppUpdateSet, get: AppUpdateGet) {
  let refreshing: Promise<void> | null = null;
  let inspectionEpoch = 0;
  const resumableStatus = () =>
    get().packageDownloaded ? "downloaded" : get().update ? "available" : "idle";
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

      inspectionEpoch += 1;
      set({ status: "preparing", preparationCancelable: true, packageDownloaded: true, error: null });
      try {
        const { installAppUpdateAndRestart } =
          await import("@/services/appUpdateService");
        await installAppUpdateAndRestart((phase) => {
          if (
            phase === "installing" &&
            activeUpdateBlockingTaskCount(useTaskStore.getState().tasks) > 0
          ) {
            throw new Error(
              "New work started while waiting for backups. Finish or cancel active tasks, then install again.",
            );
          }
          set({ status: phase, preparationCancelable: phase === "preparing" });
        });
        set({ status: "installing", preparationCancelable: false, packageDownloaded: false });
      } catch (error) {
        inspectionEpoch += 1;
        const name = error instanceof Error ? error.name : "";
        set({
          status: name === "AppUpdateRestartRequired" ? "restart-required" : "downloaded",
          preparationCancelable: false,
          packageDownloaded: name !== "AppUpdateRestartRequired",
          error: name === "AppUpdatePreparationCancelled" ? null : describeUpdateError(error),
        });
        await get().refreshInstallationStatus();
      }
    },
    cancelInstallationPreparation: async () => {
      if (get().status !== "preparing" || !get().preparationCancelable) return;
      try {
        const { cancelAppUpdatePreparation } =
          await import("@/services/appUpdateService");
        await cancelAppUpdatePreparation();
      } catch (error) {
        set({ error: describeUpdateError(error) });
      }
    },
    refreshInstallationStatus: () => {
      if (refreshing) return refreshing;
      const epoch = inspectionEpoch;
      refreshing = (async () => {
        try {
          const { getAppUpdateInstallationStatus } =
            await import("@/services/appUpdateService");
          const nativeInstallation = await getAppUpdateInstallationStatus();
          if (epoch !== inspectionEpoch) return;
          set({ nativeInstallation });
          if (!nativeInstallation.recoveryRequired && nativeInstallation.phase !== "idle") {
            const phase = nativeInstallation.phase;
            if (
              !(phase === "preparing" && get().status === "installing") &&
              get().status !== "restart-required"
            ) {
              set({ status: phase === "restartRequired" ? "restart-required" : phase });
            }
            if (phase === "restartRequired") set({ packageDownloaded: false });
          } else if (
            nativeInstallation.phase === "idle" && !get().preparationCancelable &&
            (get().status === "preparing" || get().status === "installing")
          ) {
            set({ status: resumableStatus() });
          }
        } catch (error) {
          if (epoch !== inspectionEpoch) return;
          if (error instanceof Error && error.name === "AppUpdateUnsupportedError") return;
          set({ error: describeUpdateError(error) });
        }
      })().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    recoverBackupsAfterUpdate: async () => {
      const id = get().nativeInstallation?.installationId;
      if (!id || !get().nativeInstallation?.recoveryRequired) return;
      inspectionEpoch += 1;
      try {
        const { recoverAppUpdateBackups } =
          await import("@/services/appUpdateService");
        await recoverAppUpdateBackups(id);
        set({ nativeInstallation: null, status: resumableStatus(), error: null });
      } catch (error) {
        set({ error: describeUpdateError(error) });
      }
    },
    restartInstalledUpdate: async () => {
      if (get().status !== "restart-required") return;
      try {
        const { restartAfterAppUpdate } = await import("@/services/appUpdateService");
        await restartAfterAppUpdate();
      } catch (error) {
        set({ error: describeUpdateError(error) });
      }
    },
  };
}
