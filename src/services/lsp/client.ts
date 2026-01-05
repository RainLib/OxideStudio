import { invoke } from "@tauri-apps/api/core";
import type {
  CompletionItem,
  CompletionResponse,
  Diagnostic,
  HoverInfo,
} from "./types";

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
   * Update database schema in LSP server
   * @param schemaJson JSON string of database schema
   */
  async updateSchema(schemaJson: string): Promise<void> {
    if (!this.initialized) {
      console.warn("[LSP] Not initialized, skipping schema update");
      return;
    }

    try {
      const result = await invoke<string>("lsp_update_schema", {
        schemaJson,
      });

      console.log("[LSP] Schema updated:", result);
    } catch (error) {
      console.error("[LSP] Schema update failed:", error);
      throw error;
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
