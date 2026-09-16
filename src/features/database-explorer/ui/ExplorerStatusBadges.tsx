import { type ConnectionRuntimeState } from "@/store/useConnectionStore";
import { type MetadataNodeState } from "@/store/useSchemaStore";
import { RefreshCw } from "lucide-react";

export function MetadataNodeBadge({ state }: { state?: MetadataNodeState }) {
  if (!state || state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <RefreshCw
        size={10}
        className="shrink-0 animate-spin text-[hsl(var(--wb-text-muted))]"
        aria-label="Loading metadata"
      />
    );
  }

  if (state.status === "error") {
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
        title={state.message || "Metadata refresh failed"}
        aria-label="Metadata refresh failed"
      />
    );
  }

  if (state.status === "stale") {
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80"
        title={state.message || "Metadata may be stale"}
        aria-label="Cached metadata may be stale"
      />
    );
  }

  return null;
}

export function ConnectionRuntimeBadge({
  runtime,
  isConnected,
  isConnecting,
}: {
  runtime?: ConnectionRuntimeState;
  isConnected: boolean;
  isConnecting: boolean;
}) {
  if (isConnecting || runtime?.status === "connecting") {
    return (
      <RefreshCw
        size={10}
        className="shrink-0 animate-spin text-[hsl(var(--wb-text-muted))]"
        aria-label="Connecting"
      />
    );
  }
  if (runtime?.status === "error") {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-1 ring-red-500/25"
        title={runtime.message || "Connection failed"}
        aria-label="Connection failed"
      />
    );
  }
  if (isConnected || runtime?.status === "connected") {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 ring-1 ring-emerald-400/25"
        title="Connected"
        aria-label="Connected"
      />
    );
  }
  return null;
}
