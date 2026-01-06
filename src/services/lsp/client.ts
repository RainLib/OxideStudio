import { invoke } from "@tauri-apps/api/core";
import type { CompletionItem, CompletionResponse } from "./types";

/**
 * LSP Client Service
 * Manages communication with the LSP server via Tauri commands
 */
class LspClient {
  private initialized = false;
  private binaryPath: string | null = null;
  private pendingDocuments: Map<string, { text: string; version: number }> =
    new Map();

  /**
   * Initialize the LSP server
   * @param binaryPath Path to sql-lsp binary
   */
  async initialize(binaryPath: string): Promise<void> {
    console.log("[LSP Client] 🚀 Starting initialization...", { binaryPath });
    if (this.initialized) {
      console.log("[LSP Client] ℹ️ Already initialized");
      return;
    }

    try {
      const result = await invoke<string>("lsp_initialize", {
        request: { binary_path: binaryPath },
      });

      this.initialized = true;
      this.binaryPath = binaryPath;

      console.log("[LSP Client] ✓ Initialization complete", { result });

      // Sync any pending documents that were queued before initialization
      if (this.pendingDocuments.size > 0) {
        console.log(
          `[LSP Client] 📚 Syncing ${this.pendingDocuments.size} pending documents...`
        );
        for (const [uri, doc] of this.pendingDocuments.entries()) {
          console.log(`[LSP Client] 🔄 Syncing document: ${uri}`);
          await this._sendDidOpen(uri, doc.text, doc.version);
        }
        this.pendingDocuments.clear();
        console.log("[LSP Client] ✓ All pending documents synced");
      }
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
    console.log("[LSP Client] 💡 getCompletions called", {
      uri,
      line,
      character,
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
    });
    if (!this.initialized) {
      console.warn(
        "[LSP Client] ⚠️ Not initialized, returning empty completions"
      );
      return [];
    }

    try {
      const normalized = this.normalizeUri(uri);
      console.log("[LSP Client] 📤 Requesting completions", {
        normalized,
        line,
        character,
      });
      const response = await invoke<CompletionResponse>("lsp_get_completions", {
        request: { uri: normalized, line, character },
      });

      console.log("[LSP Client] ✓ Received completions", {
        count: response.items.length,
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
    console.log("[LSP Client] ⚙️ updateConfiguration called", {
      config,
      initialized: this.initialized,
    });
    if (!this.initialized) {
      console.warn("[LSP Client] ⚠️ Not initialized, skipping config update");
      return;
    }

    try {
      // Wrap in sqls settings object as expected by the server
      const settings = {
        sqls: config,
      };

      console.log("[LSP Client] 📤 Sending configuration", { settings });
      await invoke<string>("lsp_did_change_configuration", {
        settings,
      });

      console.log("[LSP Client] ✓ Configuration updated successfully");
    } catch (error) {
      console.error("[LSP] Configuration update failed:", error);
      throw error;
    }
  }

  /**
   * Private method to actually send didOpen to LSP
   */
  private async _sendDidOpen(
    uri: string,
    text: string,
    version: number
  ): Promise<void> {
    const normalized = this.normalizeUri(uri);
    await invoke("lsp_did_open", {
      uri: normalized,
      languageId: "sql",
      version,
      text,
    });
    console.log("[LSP Client] ✓ didOpen sent successfully", { normalized });
  }

  /**
   * Notify LSP that a document was opened
   * If LSP is not ready, queue the document for later sync
   */
  async didOpen(uri: string, text: string, version: number): Promise<void> {
    console.log("[LSP Client] 📄 didOpen called", {
      uri,
      textLength: text.length,
      version,
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
    });

    if (!this.initialized) {
      console.warn("[LSP Client] ⏸️ LSP not ready, queuing document:", uri);
      this.pendingDocuments.set(uri, { text, version });
      return;
    }

    try {
      await this._sendDidOpen(uri, text, version);
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
      const normalized = this.normalizeUri(uri);
      await invoke("lsp_did_change", { uri: normalized, version, text });
      // console.log("[LSP] didChange:", normalized);
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
      const normalized = this.normalizeUri(uri);
      await invoke("lsp_did_close", { uri: normalized });
    } catch (e) {
      console.error("[LSP] didClose failed:", e);
    }
  }

  /**
   * Helper to normalize URI for 'sqls'
   * Converts inmemory:// schemes to file:// to ensure compatibility
   */
  private normalizeUri(uri: string): string {
    if (uri.startsWith("inmemory://")) {
      // Convert "inmemory://model/1" to "file:///virtual/1.sql"
      // Ensure it looks like a valid file path with sql extension
      const path = uri.replace("inmemory://model/", "");
      return `file:///virtual/${path}.sql`;
    }
    return uri;
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
