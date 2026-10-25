import { useEffect } from "react";
import {
  UPDATE_CHECK_INTERVAL_MS,
  useUpdateStore,
} from "@/store/useUpdateStore";

const STARTUP_CHECK_DELAY_MS = 2_000;

export function useAppUpdatePolling() {
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const refreshInstallationStatus = useUpdateStore((state) => state.refreshInstallationStatus);
  const needsInstallationRefresh = useUpdateStore((state) =>
    state.status === "preparing" || state.status === "installing" ||
    state.nativeInstallation?.recoveryRequired === true,
  );

  useEffect(() => {
    const startupTimer = window.setTimeout(() => {
      void refreshInstallationStatus().then(() => {
        if (!useUpdateStore.getState().nativeInstallation?.recoveryRequired) {
          return checkForUpdates();
        }
      });
    }, STARTUP_CHECK_DELAY_MS);
    const interval = window.setInterval(() => {
      void checkForUpdates();
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [checkForUpdates, refreshInstallationStatus]);

  useEffect(() => {
    if (!needsInstallationRefresh) return;
    let stopped = false;
    let timer: number;
    const refresh = async () => {
      await refreshInstallationStatus();
      if (!stopped) timer = window.setTimeout(refresh, 2_000);
    };
    timer = window.setTimeout(refresh, 2_000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [needsInstallationRefresh, refreshInstallationStatus]);
}
