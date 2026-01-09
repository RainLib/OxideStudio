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
      console.log("[useLspClient] 🚀 Starting LSP initialization...");

      // If already initialized in service, just update state
      if (lspClient.isInitialized()) {
        console.log("[useLspClient] ✓ LSP already initialized");
        if (mounted) {
          setIsReady(true);
          setError(null);
        }
        return;
      }

      try {
        console.log("[useLspClient] 📞 Calling check_lsp_binary...");

        // Get binary path from backend command
        const info = await invoke<{ path: string; exists: boolean }>(
          "check_lsp_binary"
        );

        console.log("[useLspClient] 📋 Binary info:", info);

        if (!info.exists) {
          const errorMsg = "LSP binary not found at: " + info.path;
          console.error("[useLspClient] ❌", errorMsg);
          throw new Error(errorMsg);
        }

        console.log("[useLspClient] ✓ Binary found, initializing client...");
        console.log("[useLspClient] Binary path:", info.path);

        await lspClient.initialize(info.path);

        console.log("[useLspClient] ✅ LSP client initialized successfully!");

        if (mounted) {
          setIsReady(true);
          setError(null);
        }
      } catch (err) {
        console.error("[useLspClient] ❌ Initialization failed:", err);
        console.error("[useLspClient] Error details:", {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
          setIsReady(false);
        }
      }
    }

    console.log("[useLspClient] Hook mounted, starting initialization");
    initializeLsp();

    // Do NOT shutdown on unmount, as other components might use it.
    return () => {
      console.log("[useLspClient] Hook unmounting");
      mounted = false;
    };
  }, []);

  return {
    isReady,
    error,
    client: lspClient,
  };
}
