import { invoke } from "@tauri-apps/api/core";
import type { LspCancellationToken } from "./contracts";

export function requestSessionPayload(sessionKey: string): Record<string, string> {
  return sessionKey === "default" ? {} : { session_key: sessionKey };
}

export function commandSessionPayload(sessionKey: string): Record<string, string> {
  return sessionKey === "default" ? {} : { sessionKey };
}

export async function invokeLspCommand<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  return await invoke<T>(command, payload);
}

export async function invokeCancellableLspCommand<T>(options: {
  sessionKey: string;
  requestToken: string;
  command: "lsp_get_completions" | "lsp_resolve_completion";
  request: Record<string, unknown>;
  token?: LspCancellationToken;
}): Promise<T> {
  const { command, request, requestToken, sessionKey, token } = options;
  if (token?.isCancellationRequested) {
    throw new Error("LSP request cancelled");
  }

  const response = invoke<T>(command, {
    request: { ...request, request_token: requestToken },
  });
  let cancellationSent = false;
  const cancel = () => {
    if (cancellationSent) return;
    cancellationSent = true;
    void invoke<boolean>("lsp_cancel_request", {
      ...commandSessionPayload(sessionKey),
      requestToken,
    }).catch(() => undefined);
  };
  const cancellation = token?.onCancellationRequested?.(cancel);
  if (token?.isCancellationRequested) cancel();

  try {
    return await response;
  } finally {
    cancellation?.dispose();
  }
}
