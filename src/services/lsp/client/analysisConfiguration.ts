import type { LspClientBridge } from "./contracts";
import { isObject } from "./parsing";

/** A notification write is not evidence that the server committed its settings. */
export async function confirmLspAnalysisConfiguration(
  client: LspClientBridge,
  token: string,
): Promise<boolean> {
  if (!client.isInitialized() || !/^[A-Za-z0-9_-]{1,128}$/.test(token)) return false;
  const value = await client.invoke<unknown>("lsp_request", {
    request: {
      ...client.requestSessionPayload(),
      method: "oxide/analysisConfiguration",
      params: { oxideAnalysisToken: token },
    },
  });
  return client.isInitialized() && isObject(value) && value.applied === true &&
    value.oxideAnalysisToken === token;
}
