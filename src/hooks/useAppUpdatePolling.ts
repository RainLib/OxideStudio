import { useEffect } from "react";
import {
  UPDATE_CHECK_INTERVAL_MS,
  useUpdateStore,
} from "@/store/useUpdateStore";

const STARTUP_CHECK_DELAY_MS = 2_000;

export function useAppUpdatePolling() {
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);

  useEffect(() => {
    const startupTimer = window.setTimeout(() => {
      void checkForUpdates();
    }, STARTUP_CHECK_DELAY_MS);
    const interval = window.setInterval(() => {
      void checkForUpdates();
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [checkForUpdates]);
}
