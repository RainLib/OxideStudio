import { useEffect, useState } from "react";
import { lspClient } from "@/services/lsp";
import { invoke } from "@tauri-apps/api/core";

/**
 * Hook to manage LSP client lifecycle
 * Initializes LSP server on mount and provides status
 */
export function useLspClient() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initializeLsp() {
      // If already initialized in service, just update state
      if (lspClient.isInitialized()) {
        if (mounted) {
          setIsReady(true);
          setError(null);
        }
        return;
      }

      try {
        // Get binary path from backend command
        // This ensures match with what download manager used
        const info = await invoke<{ path: string; exists: boolean }>(
          "check_lsp_binary"
        );

        if (!info.exists) {
          throw new Error("LSP binary not found. Please wait for download.");
        }

        console.log("[useLspClient] Initializing with binary:", info.path);

        await lspClient.initialize(info.path);

        if (mounted) {
          setIsReady(true);
          setError(null);
        }
      } catch (err) {
        console.error("[useLspClient] Initialization failed:", err);
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
          setIsReady(false);
        }
      }
    }

    initializeLsp();

    // Do NOT shutdown on unmount, as other components might use it.
    // Shutdown should be handled by app close or explicit user action if needed.
    return () => {
      mounted = false;
    };
  }, []);

  return {
    isReady,
    error,
    client: lspClient,
  };
}
