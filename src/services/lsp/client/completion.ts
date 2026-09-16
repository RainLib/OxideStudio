import { redactSecrets } from "@/lib/redaction";
import type {
  CompletionContext,
  CompletionItem,
  CompletionResponse,
} from "../types";
import type { LspCancellationToken, LspClientBridge } from "./contracts";

const emptyCompletionResponse = (): CompletionResponse => ({
  items: [],
  isIncomplete: false,
  resolveProvider: false,
});

export async function getLspCompletionList(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
  context?: CompletionContext,
  token?: LspCancellationToken,
): Promise<CompletionResponse> {
  if (!client.isInitialized()) {
    console.warn("[LSP] Not initialized, returning empty completions");
    return emptyCompletionResponse();
  }

  try {
    console.log("[LSP] → Request: textDocument/completion", {
      uri,
      position: { line, character },
      context,
    });
    const response = await client.invokeCancellable<CompletionResponse>(
      "lsp_get_completions",
      {
        ...client.requestSessionPayload(),
        uri,
        line,
        character,
        context,
      },
      token,
    );
    const completionList = {
      items: Array.isArray(response.items) ? response.items : [],
      isIncomplete: response.isIncomplete === true,
      resolveProvider: response.resolveProvider === true,
    };
    console.log(`[LSP] ← Response: Got ${completionList.items.length} items`);
    return completionList;
  } catch (error) {
    if (!token?.isCancellationRequested) {
      console.error("[LSP] ✗ Get completions failed:", error);
    }
    return emptyCompletionResponse();
  }
}

export async function resolveLspCompletionItem(
  client: LspClientBridge,
  item: CompletionItem,
  token?: LspCancellationToken,
): Promise<CompletionItem> {
  if (!client.isInitialized()) return item;

  try {
    return await client.invokeCancellable<CompletionItem>(
      "lsp_resolve_completion",
      { ...client.requestSessionPayload(), item },
      token,
    );
  } catch (error) {
    if (!token?.isCancellationRequested) {
      console.warn("[LSP] Completion resolve failed:", redactSecrets(error));
    }
    return item;
  }
}
