import { lazy, Suspense, useEffect, useState } from "react";

const QueryHistorySync = lazy(() =>
  import("@/components/workspace/QueryHistorySync").then((module) => ({
    default: module.QueryHistorySync,
  })),
);

export function DeferredQueryHistorySync() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => setEnabled(true), {
        timeout: 1_500,
      });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(() => setEnabled(true), 1_000);
    return () => window.clearTimeout(handle);
  }, []);

  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <QueryHistorySync />
    </Suspense>
  );
}
