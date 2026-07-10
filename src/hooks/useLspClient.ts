import { useEffect, useMemo, useState } from "react";
import type { DatabaseDriver } from "@/services/tauri/types";
import {
  ensureLspSession,
  getLspSessionDescriptor,
  lspClient,
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
          })
        : null,
    [enabled, options.connectionId, options.driver]
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

    if (descriptor.client.isInitialized()) {
      setIsReady(true);
      setError(null);
      setStatus("ready");
      return;
    }

    setIsReady(false);
    setError(null);
    setStatus("starting");

    ensureLspSession({
      connectionId: options.connectionId,
      driver: options.driver,
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

    return () => {
      mounted = false;
    };
  }, [descriptor, options.connectionId, options.driver]);

  return {
    isReady,
    error,
    status,
    profile: descriptor?.profile ?? null,
    sessionKey: descriptor?.key ?? "default",
    client: descriptor?.client ?? lspClient,
  };
}
