import { redactSecrets } from "@/lib/redaction";
import type { InlineLspContext } from "@/services/tauri/ai.service";
import type { LspClientBridge } from "./contracts";
import { isObject } from "./parsing";

export async function getLspInlineCompletionContext(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
): Promise<InlineLspContext> {
  if (!client.isInitialized()) return {};
  try {
    const response = await client.invoke<unknown>(
      "lsp_inline_completion_context",
      {
        request: { ...client.requestSessionPayload(), uri, line, character },
      },
    );
    return isObject(response) ? (response as InlineLspContext) : {};
  } catch (error) {
    console.error("[LSP] Inline completion context failed:", error);
    return {};
  }
}

export async function validateLspInlineCompletion(
  client: LspClientBridge,
  uri: string,
  text: string,
): Promise<Array<{ severity?: number; message: string }>> {
  if (!client.isInitialized()) return [];
  try {
    const response = await client.invoke<unknown>(
      "lsp_validate_inline_completion",
      { request: { ...client.requestSessionPayload(), uri, text } },
    );
    if (!Array.isArray(response)) return [];
    return response
      .filter(
        (item): item is Record<string, unknown> =>
          isObject(item) && typeof item.message === "string",
      )
      .map((item) => ({
        severity: typeof item.severity === "number" ? item.severity : undefined,
        message: item.message as string,
      }));
  } catch (error) {
    console.error("[LSP] Inline completion validation failed:", error);
    return [];
  }
}

export async function updateLspConfiguration(
  client: LspClientBridge,
  config: any,
): Promise<void> {
  if (!client.isInitialized()) return;
  try {
    await client.invoke<string>("lsp_did_change_configuration", {
      settings: config,
      ...client.commandSessionPayload(),
    });
    const schemas = Array.isArray(config?.schemas) ? config.schemas : [];
    const tableCount = schemas.reduce(
      (count: number, schema: any) =>
        count + (Array.isArray(schema?.tables) ? schema.tables.length : 0),
      0,
    );
    const functionCount = schemas.reduce(
      (count: number, schema: any) =>
        count + (Array.isArray(schema?.functions) ? schema.functions.length : 0),
      0,
    );
    console.log(
      "[LSP] Configuration updated",
      redactSecrets({
        defaultDialect: config?.defaultDialect,
        schemas: schemas.length,
        tables: tableCount,
        functions: functionCount,
        files: Object.keys(config?.fileSchemas || {}).length,
      }),
    );
  } catch (error) {
    console.error("[LSP] Configuration update failed:", error);
    throw error;
  }
}

export async function notifyLspDidOpen(
  client: LspClientBridge,
  uri: string,
  text: string,
  version: number,
  languageId = "sql",
): Promise<void> {
  if (!client.isInitialized()) return;
  try {
    console.log("[LSP] → Notification: textDocument/didOpen", {
      uri,
      version,
      textLength: text.length,
    });
    await client.invoke("lsp_did_open", {
      uri,
      languageId,
      version,
      text,
      ...client.commandSessionPayload(),
    });
    console.log("[LSP] ✓ didOpen sent");
  } catch (error) {
    console.error("[LSP] ✗ didOpen failed:", error);
  }
}

export async function notifyLspDidChange(
  client: LspClientBridge,
  uri: string,
  text: string,
  version: number,
): Promise<void> {
  if (!client.isInitialized()) return;
  try {
    console.log("[LSP] → Notification: textDocument/didChange", {
      uri,
      version,
      textLength: text.length,
    });
    await client.invoke("lsp_did_change", {
      uri,
      version,
      text,
      ...client.commandSessionPayload(),
    });
    console.log("[LSP] ✓ didChange sent");
  } catch (error) {
    console.error("[LSP] ✗ didChange failed:", error);
  }
}

export async function notifyLspDidClose(
  client: LspClientBridge,
  uri: string,
): Promise<void> {
  if (!client.isInitialized()) return;
  try {
    console.log("[LSP] → Notification: textDocument/didClose", { uri });
    await client.invoke("lsp_did_close", {
      uri,
      ...client.commandSessionPayload(),
    });
    console.log("[LSP] ✓ didClose sent");
  } catch (error) {
    console.error("[LSP] ✗ didClose failed:", error);
  }
}
