import {useSyncExternalStore} from "react";
import type {LspClient} from "@/services/lsp/client/LspClient";

export type LspRuntimePort=Pick<LspClient,"getRuntimeSnapshot"|"subscribeRuntime">;

/** A retained client/session key can outlive the process and its documents. */
export function useLspRuntimeSnapshot(client:LspRuntimePort){
  return useSyncExternalStore(client.subscribeRuntime,client.getRuntimeSnapshot,client.getRuntimeSnapshot);
}
