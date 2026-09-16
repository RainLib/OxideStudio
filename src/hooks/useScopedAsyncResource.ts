import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncResourceState<T> = {
  scope: string | null;
  phase: "idle" | "loading" | "ready" | "error";
  value: T | null;
  error: string | null;
};

/** Read-only resources: keep same-scope content during refresh, discard stale responses. */
export function useScopedAsyncResource<T>(scope: string | null) {
  const sequence = useRef(0);
  const currentScope = useRef(scope);
  const mounted = useRef(false);
  currentScope.current = scope;
  const [state, setState] = useState<AsyncResourceState<T>>({
    scope, phase: "idle", value: null, error: null,
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current += 1; };
  }, []);
  useEffect(() => () => { sequence.current += 1; }, [scope]);

  const run = useCallback(async (
    load: () => Promise<T | null>,
    onResolved?: (value: T) => void,
  ) => {
    if (!scope || !mounted.current) return;
    const request = ++sequence.current;
    const isCurrent = () => mounted.current && currentScope.current === scope && sequence.current === request;
    setState((previous) => ({
      scope, phase: "loading", error: null,
      value: previous.scope === scope ? previous.value : null,
    }));
    try {
      const value = await load();
      if (!isCurrent()) return;
      if (value !== null) onResolved?.(value);
      setState({ scope, phase: value === null ? "idle" : "ready", value, error: null });
      return value;
    } catch (error) {
      if (!isCurrent()) return;
      setState((previous) => ({
        ...previous, scope, phase: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [scope]);

  return {
    state: state.scope === scope ? state : { scope, phase: "idle" as const, value: null, error: null },
    run,
  };
}
