import { invoke } from "@tauri-apps/api/core";
import { redactSecrets } from "@/lib/redaction";
import type {
  CompletionContext,
  CompletionItem,
  CompletionResponse,
  HoverInfo,
  Location,
  Range,
  TextEdit,
} from "./types";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMarkup(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(normalizeMarkup).filter(Boolean).join("\n\n");
  }
  if (isObject(value)) {
    if (typeof value.language === "string" && typeof value.value === "string") {
      return "```" + value.language + "\n" + value.value + "\n```";
    }
    if (typeof value.value === "string") return value.value;
  }
  return "";
}

function parseRange(value: unknown): Range | undefined {
  if (!isObject(value) || !isObject(value.start) || !isObject(value.end)) {
    return undefined;
  }

  const startLine = Number(value.start.line);
  const startCharacter = Number(value.start.character);
  const endLine = Number(value.end.line);
  const endCharacter = Number(value.end.character);

  if (
    !Number.isFinite(startLine) ||
    !Number.isFinite(startCharacter) ||
    !Number.isFinite(endLine) ||
    !Number.isFinite(endCharacter)
  ) {
    return undefined;
  }

  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function parseLocation(value: unknown): Location | null {
  if (!isObject(value) || typeof value.uri !== "string") return null;
  const range = parseRange(value.range);
  if (!range) return null;
  return { uri: value.uri, range };
}

function parseLocationLink(value: unknown): Location | null {
  if (!isObject(value) || typeof value.targetUri !== "string") return null;
  const range = parseRange(value.targetSelectionRange) || parseRange(value.targetRange);
  if (!range) return null;
  return { uri: value.targetUri, range };
}

function parseLocations(value: unknown): Location[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((item) => parseLocation(item) || parseLocationLink(item))
    .filter((item): item is Location => Boolean(item));
}

function parseTextEdits(value: unknown): TextEdit[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isObject(item) || typeof item.newText !== "string") return null;
      const range = parseRange(item.range);
      if (!range) return null;
      return { range, newText: item.newText };
    })
    .filter((item): item is TextEdit => Boolean(item));
}

/**
 * LSP Client Service
 * Manages communication with the LSP server via Tauri commands
 */
class LspClient {
  private initialized = false;
  private binaryPath: string | null = null;
  private initializationPromise: Promise<void> | null = null;
  private sessionKey: string;

  constructor(sessionKey = "default") {
    this.sessionKey = sessionKey;
  }

  private requestSessionPayload() {
    return this.sessionKey === "default" ? {} : { session_key: this.sessionKey };
  }

  private commandSessionPayload() {
    return this.sessionKey === "default" ? {} : { sessionKey: this.sessionKey };
  }

  /**
   * Initialize the LSP server
   * @param binaryPath Path to sql-lsp binary
   */
  async initialize(binaryPath: string): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.initialized) {
      const running = await this.isRunning();
      if (running) {
        console.log("[LSP] Already initialized");
        return;
      }

      console.warn("[LSP] Local state was initialized, but backend process is not running");
      this.initialized = false;
      this.binaryPath = null;
    }

    this.initializationPromise = this.initializeServer(binaryPath).finally(() => {
      this.initializationPromise = null;
    });

    return this.initializationPromise;
  }

  private async initializeServer(binaryPath: string): Promise<void> {
    try {
      const result = await invoke<string>("lsp_initialize", {
        request: {
          binary_path: binaryPath,
          ...this.requestSessionPayload(),
        },
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
      const result = await invoke<string>("lsp_shutdown", {
        ...this.commandSessionPayload(),
      });
      this.initialized = false;
      this.initializationPromise = null;
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
      return await invoke<boolean>("lsp_is_running", {
        ...this.commandSessionPayload(),
      });
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
    character: number,
    context?: CompletionContext
  ): Promise<CompletionItem[]> {
    if (!this.initialized) {
      console.warn("[LSP] Not initialized, returning empty completions");
      return [];
    }

    try {
      console.log(`[LSP] → Request: textDocument/completion`, {
        uri,
        position: { line, character },
        context,
      });

      const response = await invoke<CompletionResponse>("lsp_get_completions", {
        request: {
          ...this.requestSessionPayload(),
          uri,
          line,
          character,
          context,
        },
      });

      console.log(`[LSP] ← Response: Got ${response.items.length} items`);
      if (response.items.length > 0) {
        console.log(`[LSP] First 3 items:`, response.items.slice(0, 3));
      }

      return response.items;
    } catch (error) {
      console.error("[LSP] ✗ Get completions failed:", error);
      return [];
    }
  }

  async getHover(
    uri: string,
    line: number,
    character: number
  ): Promise<HoverInfo | null> {
    if (!this.initialized) return null;

    try {
      const response = await invoke<unknown>("lsp_hover", {
        request: { ...this.requestSessionPayload(), uri, line, character },
      });
      if (!isObject(response)) return null;

      const contents = normalizeMarkup(response.contents);
      if (!contents) return null;

      return {
        contents,
        range: parseRange(response.range),
      };
    } catch (error) {
      console.error("[LSP] ✗ Hover failed:", error);
      return null;
    }
  }

  async getDefinitions(
    uri: string,
    line: number,
    character: number
  ): Promise<Location[]> {
    if (!this.initialized) return [];

    try {
      const response = await invoke<unknown>("lsp_goto_definition", {
        request: { ...this.requestSessionPayload(), uri, line, character },
      });
      return parseLocations(response);
    } catch (error) {
      console.error("[LSP] ✗ Definition failed:", error);
      return [];
    }
  }

  async getReferences(
    uri: string,
    line: number,
    character: number
  ): Promise<Location[]> {
    if (!this.initialized) return [];

    try {
      const response = await invoke<unknown>("lsp_references", {
        request: { ...this.requestSessionPayload(), uri, line, character },
      });
      return parseLocations(response);
    } catch (error) {
      console.error("[LSP] ✗ References failed:", error);
      return [];
    }
  }

  async formatDocument(
    uri: string,
    tabSize: number,
    insertSpaces: boolean
  ): Promise<TextEdit[]> {
    if (!this.initialized) return [];

    try {
      const response = await invoke<unknown>("lsp_formatting", {
        request: {
          ...this.requestSessionPayload(),
          uri,
          tab_size: tabSize,
          insert_spaces: insertSpaces,
        },
      });
      return parseTextEdits(response);
    } catch (error) {
      console.error("[LSP] ✗ Formatting failed:", error);
      return [];
    }
  }

  /**
   * Update LSP configuration (connections)
   * Sends workspace/didChangeConfiguration notification
   *
   * Current format: Simple DSN-based connection configuration
   * Future enhancement: Can include full schema with tables/columns per LSP spec
   *
   * @param config Connection configuration
   * @example
   * // Simple format (current)
   * await updateConfiguration({
   *   connections: [{ driver: "mysql", dataSourceName: "user:pass@tcp(host:port)/db" }]
   * });
   *
   * // Full schema format (future)
   * await updateConfiguration({
   *   sql: {
   *     schemas: [{
   *       id: "uuid",
   *       database: "my_db",
   *       tables: [{ name: "users", columns: [...] }]
   *     }]
   *   }
   * });
   */
  async updateConfiguration(config: any): Promise<void> {
    if (!this.initialized) {
      // console.warn("[LSP] Not initialized, skipping config update");
      return;
    }

    try {
      // Send config directly - backend will wrap it in { settings: ... }
      // Final structure will be: { settings: { connections: [...], fileSchemas: {...} } }
      await invoke<string>("lsp_did_change_configuration", {
        settings: config, // Don't wrap in sqls - send directly
        ...this.commandSessionPayload(),
      });

      const schemas = Array.isArray(config?.schemas) ? config.schemas : [];
      const tableCount = schemas.reduce(
        (count: number, schema: any) =>
          count + (Array.isArray(schema?.tables) ? schema.tables.length : 0),
        0
      );
      const functionCount = schemas.reduce(
        (count: number, schema: any) =>
          count +
          (Array.isArray(schema?.functions) ? schema.functions.length : 0),
        0
      );
      console.log(
        "[LSP] Configuration updated",
        redactSecrets({
          defaultDialect: config?.defaultDialect,
          schemas: schemas.length,
          tables: tableCount,
          functions: functionCount,
          files: Object.keys(config?.fileSchemas || {}).length,
        })
      );
    } catch (error) {
      console.error("[LSP] Configuration update failed:", error);
      throw error;
    }
  }

  /**
   * Notify LSP that a document was opened
   * Must be called before any completion/hover requests
   *
   * Supports arbitrary URI schemes:
   * - file:///path/to/file.sql (saved files)
   * - untitled:Untitled-1 (unsaved documents)
   * - inmemory-model://model/1 (Monaco virtual models)
   *
   * @param uri Document URI (any scheme)
   * @param text Full document text
   * @param version Document version (increment on each change)
   * @param languageId LSP language id used for dialect inference
   */
  async didOpen(
    uri: string,
    text: string,
    version: number,
    languageId = "sql"
  ): Promise<void> {
    if (!this.initialized) return;
    try {
      console.log(`[LSP] → Notification: textDocument/didOpen`, {
        uri,
        version,
        textLength: text.length,
        preview: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      });

      await invoke("lsp_did_open", {
        uri,
        languageId,
        version,
        text,
        ...this.commandSessionPayload(),
      });
      console.log("[LSP] ✓ didOpen sent");
    } catch (e) {
      console.error("[LSP] ✗ didOpen failed:", e);
    }
  }

  /**
   * Notify LSP that a document changed
   */
  async didChange(uri: string, text: string, version: number): Promise<void> {
    if (!this.initialized) return;
    try {
      console.log(`[LSP] → Notification: textDocument/didChange`, {
        uri,
        version,
        textLength: text.length,
      });

      await invoke("lsp_did_change", {
        uri,
        version,
        text,
        ...this.commandSessionPayload(),
      });
      console.log("[LSP] ✓ didChange sent");
    } catch (e) {
      console.error("[LSP] ✗ didChange failed:", e);
    }
  }

  /**
   * Notify LSP that a document was closed
   */
  async didClose(uri: string): Promise<void> {
    if (!this.initialized) return;
    try {
      console.log(`[LSP] → Notification: textDocument/didClose`, { uri });
      await invoke("lsp_did_close", {
        uri,
        ...this.commandSessionPayload(),
      });
      console.log("[LSP] ✓ didClose sent");
    } catch (e) {
      console.error("[LSP] ✗ didClose failed:", e);
    }
  }

  /**
   * Schema synchronization is owned by <LspConnectionSyncer /> so it can read
   * React store state and debounce metadata fetches in one place.
   */
  async syncSchemaFromConnection(): Promise<void> {
    console.warn("[LSP] syncSchemaFromConnection is handled by LspConnectionSyncer");
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

  getSessionKey(): string {
    return this.sessionKey;
  }
}

// Export singleton instance
export const lspClient = new LspClient();

// Export class for testing
export { LspClient };
