import { useEffect, useMemo, useState } from "react";
import {useLspRuntimeSnapshot} from "./useLspRuntimeSnapshot";
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
  documentSessionKey?: string;
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
          documentSessionKey: options.documentSessionKey,
          driver: options.driver,
          capabilities: options.capabilities,
          })
        : null,
    [enabled, options.capabilities, options.connectionId, options.documentSessionKey, options.driver]
  );
  const [isReady, setIsReady] = useState(
    () => descriptor?.client.isInitialized() ?? false
  );
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LspRuntimeStatus>(
    descriptor ? (descriptor.client.isInitialized() ? "ready" : "idle") : "disabled"
  );
  const client=descriptor?.client??lspClient;
  const runtime=useLspRuntimeSnapshot(client);

  useEffect(() => {
    let mounted = true;

    if (!descriptor || (!options.connectionId && !options.documentSessionKey) || !options.driver) {
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

    let pendingStart:Promise<void>|undefined;
    const startOrRecover = ():Promise<void> => {
      if(pendingStart)return pendingStart;
      pendingStart=ensureLspSession({
        connectionId: options.connectionId!,
        documentSessionKey: options.documentSessionKey,
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
        }).finally(()=>{pendingStart=undefined;});
      return pendingStart;
    };
    const releaseRuntime=descriptor.client.subscribeRuntime(()=>{
      if(!mounted)return;
      const ready=descriptor.client.getRuntimeSnapshot().ready;
      setIsReady(ready);setStatus(ready?"ready":"starting");
      if(ready)setError(null);else void startOrRecover();
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
      releaseRuntime();
      if (healthTimer) clearInterval(healthTimer);
      releaseSession();
    };
  }, [descriptor, options.capabilities, options.connectionId, options.documentSessionKey, options.driver]);

  return {
    isReady:Boolean(descriptor&&isReady&&runtime.ready),
    error,
    status:!descriptor?"disabled":status==="ready"&&!runtime.ready?"starting":status,
    runtime,
    profile: descriptor?.profile ?? null,
    sessionKey: descriptor?.key ?? "default",
    client,
  };
}
