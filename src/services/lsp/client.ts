import { invoke } from "@tauri-apps/api/core";
import type { CompletionItem, CompletionResponse } from "./types";

/**
 * LSP Client Service
 * Manages communication with the LSP server via Tauri commands
 */
class LspClient {
  private initialized = false;
  private binaryPath: string | null = null;

  /**
   * Initialize the LSP server
   * @param binaryPath Path to sql-lsp binary
   */
  async initialize(binaryPath: string): Promise<void> {
    if (this.initialized) {
      console.log("[LSP] Already initialized");
      return;
    }

    try {
      const result = await invoke<string>("lsp_initialize", {
        request: { binary_path: binaryPath },
      });

      this.initialized = true;
      this.binaryPath = binaryPath;

      console.log("[LSP] Initialized:", result);
    } catch (error) {
      console.error("[LSP] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Shutdown the LSP server
   */
  async shutdown(): Promise<void> {
    try {
      const result = await invoke<string>("lsp_shutdown");
      this.initialized = false;
      console.log("[LSP] Shutdown:", result);
    } catch (error) {
      console.error("[LSP] Shutdown failed:", error);
      throw error;
    }
  }

  /**
   * Check if LSP server is running
   */
  async isRunning(): Promise<boolean> {
    try {
      return await invoke<boolean>("lsp_is_running");
    } catch (error) {
      console.error("[LSP] Status check failed:", error);
      return false;
    }
  }

  /**
   * Get SQL completions at cursor position
   * @param uri Document URI (e.g., "file:///query.sql")
   * @param line Line number (0-indexed)
   * @param character Character position (0-indexed)
   */
  async getCompletions(
    uri: string,
    line: number,
    character: number
  ): Promise<CompletionItem[]> {
    if (!this.initialized) {
      console.warn("[LSP] Not initialized, returning empty completions");
      return [];
    }

    try {
      const response = await invoke<CompletionResponse>("lsp_get_completions", {
        request: { uri, line, character },
      });

      return response.items;
    } catch (error) {
      console.error("[LSP] Get completions failed:", error);
      return [];
    }
  }

  /**
   * Update LSP configuration (connections)
   * Sends workspace/didChangeConfiguration notification
   * @param config Connection configuration
   */
  async updateConfiguration(config: any): Promise<void> {
    if (!this.initialized) {
      // console.warn("[LSP] Not initialized, skipping config update");
      return;
    }

    try {
      // Wrap in sqls settings object as expected by the server
      const settings = {
        sqls: config,
      };

      await invoke<string>("lsp_did_change_configuration", {
        settings,
      });

      console.log("[LSP] Configuration updated");
    } catch (error) {
      console.error("[LSP] Configuration update failed:", error);
      throw error;
    }
  }

  /**
   * Notify LSP that a document was opened
   */
  async didOpen(uri: string, text: string, version: number): Promise<void> {
    if (!this.initialized) return;
    try {
      await invoke("lsp_did_open", { uri, languageId: "sql", version, text });
      // console.log("[LSP] didOpen:", uri);
    } catch (e) {
      console.error("[LSP] didOpen failed:", e);
    }
  }

  /**
   * Notify LSP that a document changed
   */
  async didChange(uri: string, text: string, version: number): Promise<void> {
    if (!this.initialized) return;
    try {
      await invoke("lsp_did_change", { uri, version, text });
      // console.log("[LSP] didChange:", uri);
    } catch (e) {
      console.error("[LSP] didChange failed:", e);
    }
  }

  /**
   * Notify LSP that a document was closed
   */
  async didClose(uri: string): Promise<void> {
    if (!this.initialized) return;
    try {
      await invoke("lsp_did_close", { uri });
    } catch (e) {
      console.error("[LSP] didClose failed:", e);
    }
  }

  /**
   * Update schema from current connection
   * Fetches schema from active database connection and sends to LSP
   */
  async syncSchemaFromConnection(): Promise<void> {
    // TODO: Implement schema fetching from useSchemaStore
    // This will be implemented when integrating with Monaco Editor
    console.log("[LSP] Schema sync placeholder");
  }

  /**
   * Check if LSP is initialized and ready
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get binary path
   */
  getBinaryPath(): string | null {
    return this.binaryPath;
  }
}

// Export singleton instance
export const lspClient = new LspClient();

// Export class for testing
export { LspClient };
