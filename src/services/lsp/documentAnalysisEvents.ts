import { listen } from "@tauri-apps/api/event";
import { LSP_NOTIFICATION_EVENT } from "./types";
import { isObject } from "./client/parsing";
export type DocumentAnalysisPublication = {
  analysisToken?:string;
  version?: number;
};
export type SubscribeDocumentAnalysis = (options: {
  sessionKey: string;
  documentUri: string;
  onPublication: (publication: DocumentAnalysisPublication) => void;
}) => {
  dispose: () => void;
};

/** The bundled server republishes diagnostics after configuration commits.
 * Use that document analysis boundary, including unchanged SQL versions. */
export const subscribeDocumentAnalysis: SubscribeDocumentAnalysis = options => {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    try {
      const cleanup = await listen<unknown>(LSP_NOTIFICATION_EVENT, ({
        payload
      }) => {
        if (disposed || !isObject(payload) || payload.sessionKey !== options.sessionKey || payload.method !== "textDocument/publishDiagnostics" || !isObject(payload.params)) return;
        const params = payload.params;
        if (params.uri !== options.documentUri || !Array.isArray(params.diagnostics)) return;
        if (params.version !== undefined && (typeof params.version !== "number" || !Number.isSafeInteger(params.version) || params.version < 0)) return;
        if(params.oxideAnalysisToken!==undefined&&(typeof params.oxideAnalysisToken!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(params.oxideAnalysisToken)))return;
        options.onPublication({
          analysisToken:params.oxideAnalysisToken as string|undefined,
          version: params.version as number | undefined
        });
      });
      if (disposed) cleanup();else unlisten = cleanup;
    } catch (error) {
      if (!disposed) console.error("[LSP] Document analysis subscription failed:", error);
    }
  })();
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    }
  };
};
