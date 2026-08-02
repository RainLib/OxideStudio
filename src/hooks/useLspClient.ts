import { useEffect, useMemo, useState } from "react";
import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types";
import {
  ensureLspSession,
  getLspSessionDescriptor,
  lspClient,
  retainLspSession,
  type LspSessionDescriptor,
} from "@/services/lsp";

type LspRuntimeStatus =
  | "disabled"
  | "idle"
  | "starting"
  | "ready"
  | "error";

type UseLspClientOptions = {
  connectionId?: string | null;
  driver?: DatabaseDriver | null;
  capabilities?: DatabaseCapabilities;
  enabled?: boolean;
};

/**
 * Lazily starts the built-in LSP for the active driver and connection.
 *
 * Existing callers that do not pass a driver keep receiving the legacy default
 * client, but they do not auto-start the bundled process.
 */
export function useLspClient(options: UseLspClientOptions = {}) {
  const enabled = options.enabled !== false;
  const descriptor = useMemo<LspSessionDescriptor | null>(
    () =>
      enabled
        ? getLspSessionDescriptor({
          connectionId: options.connectionId,
          driver: options.driver,
          capabilities: options.capabilities,
          })
        : null,
    [enabled, options.capabilities, options.connectionId, options.driver]
  );
  const [isReady, setIsReady] = useState(
    () => descriptor?.client.isInitialized() ?? false
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LspRuntimeStatus>(
    descriptor ? (descriptor.client.isInitialized() ? "ready" : "idle") : "disabled"
  );

  useEffect(() => {
    let mounted = true;

    if (!descriptor || !options.connectionId || !options.driver) {
      setIsReady(false);
      setError(null);
      setStatus("disabled");
      return;
    }

    const releaseSession = retainLspSession(descriptor.key);
    let healthTimer: ReturnType<typeof setInterval> | null = null;

    setIsReady(descriptor.client.isInitialized());
    setError(null);
    setStatus(descriptor.client.isInitialized() ? "ready" : "starting");

    const startOrRecover = () =>
      ensureLspSession({
        connectionId: options.connectionId!,
        driver: options.driver!,
        capabilities: options.capabilities,
      })
        .then((nextDescriptor) => {
          if (!mounted) return;
          setIsReady(Boolean(nextDescriptor?.client.isInitialized()));
          setStatus(nextDescriptor?.client.isInitialized() ? "ready" : "disabled");
          setError(null);
        })
        .catch((err) => {
          if (!mounted) return;
          setIsReady(false);
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
        });

    void startOrRecover().then(() => {
      if (!mounted) return;
      healthTimer = setInterval(() => {
        void descriptor.client.isRunning().then((running) => {
          if (!mounted || running) return;
          setIsReady(false);
          setStatus("starting");
          void startOrRecover();
        });
      }, 15_000);
    });

    return () => {
      mounted = false;
      if (healthTimer) clearInterval(healthTimer);
      releaseSession();
    };
  }, [descriptor, options.capabilities, options.connectionId, options.driver]);

  return {
    isReady,
    error,
    status,
    profile: descriptor?.profile ?? null,
    sessionKey: descriptor?.key ?? "default",
    client: descriptor?.client ?? lspClient,
  };
}
