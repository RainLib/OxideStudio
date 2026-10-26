import { useEffect, useRef } from "react";
import type { ConnectionRuntimeState } from "@/features/connections/model/types";

/** Editors can be opened without mounting or expanding the Explorer. Acquire
 * namespaces once for that live workspace instead of waiting indefinitely. */
export function useLspNamespaceBootstrap(options: {
  connectionId: string | null;
  projectId: string;
  runtime: ConnectionRuntimeState | undefined;
  enabled: boolean;
  namespaceCount: number;
  metadataVersion: number;
  load: (connectionId: string, force: boolean) => Promise<void>;
}) {
  const attempted = useRef<{ connectionId: string; projectId: string; runtime: unknown; version: number } | null>(null);
  useEffect(() => {
    const { connectionId, projectId, runtime, enabled, namespaceCount, metadataVersion, load } = options;
    if (!enabled || !connectionId || runtime?.status !== "connected" || namespaceCount > 0) return;
    const previous = attempted.current;
    if (previous?.connectionId === connectionId && previous.projectId === projectId &&
      previous.runtime === runtime && previous.version === metadataVersion) return;
    attempted.current = { connectionId, projectId, runtime, version: metadataVersion };
    void load(connectionId, true).catch(() => {});
  }, [options.connectionId, options.projectId, options.runtime, options.enabled,
    options.namespaceCount, options.metadataVersion, options.load]);
}
