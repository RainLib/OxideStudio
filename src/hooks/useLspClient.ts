import { useEffect, useState } from "react";
import { lspClient } from "@/services/lsp";
import { resourceDir } from "@tauri-apps/api/path";

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
      try {
        // Get binary path from Tauri resources
        const resourceDirPath = await resourceDir();
        const binaryPath = `${resourceDirPath}/binaries/sql-lsp${
          process.platform === "win32" ? ".exe" : ""
        }`;

        console.log("[useLspClient] Initializing with binary:", binaryPath);

        await lspClient.initialize(binaryPath);

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

    return () => {
      mounted = false;
      // Cleanup on unmount
      lspClient.shutdown().catch(console.error);
    };
  }, []);

  return {
    isReady,
    error,
    client: lspClient,
  };
}
