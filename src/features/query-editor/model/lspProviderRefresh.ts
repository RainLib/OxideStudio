import type { DocumentAnalysisPublication } from "@/services/lsp/documentAnalysisEvents";
type Disposable = {
  dispose: () => void;
};

/** Revoke pending responses immediately; coalesce renderer notifications only.
 * A repeated publication for the same SQL version may contain new metadata. */
export function createLspProviderRefresh(options: {
  subscribe: (notify: (publication: DocumentAnalysisPublication) => void) => Disposable;
  accept: (publication: DocumentAnalysisPublication) => boolean;
  invalidate: () => void;
}) {
  let generation = 0;
  let disposed = false;
  let queued = false;
  const listeners = new Set<() => void>();
  const invalidate = () => {
    if (disposed) return;
    generation++;
    options.invalidate();
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch (error) {
          console.error("[LSP] Provider refresh listener failed:", error);
        }
      }
    });
  };
  const subscription = options.subscribe(publication => {
    if (options.accept(publication)) invalidate();
  });
  return {
    invalidate,
    get generation() {
      return generation;
    },
    isCurrent: (value: number) => !disposed && value === generation,
    onDidChange: (listener: () => void, thisArgs?: unknown, bucket?: Disposable[]) => {
      const callback = () => listener.call(thisArgs);
      if (!disposed) listeners.add(callback);
      const disposable = {
        dispose: () => {
          listeners.delete(callback);
        }
      };
      bucket?.push(disposable);
      return disposable;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      subscription.dispose();
    }
  };
}
