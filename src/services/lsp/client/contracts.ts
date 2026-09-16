export type LspCancellationToken = {
  isCancellationRequested?: boolean;
  onCancellationRequested?: (
    listener: () => void,
  ) => { dispose: () => void };
};

export type LspClientBridge = {
  isInitialized(): boolean;
  requestSessionPayload(): Record<string, string>;
  commandSessionPayload(): Record<string, string>;
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  invokeCancellable<T>(
    command: "lsp_get_completions" | "lsp_resolve_completion",
    request: Record<string, unknown>,
    token?: LspCancellationToken,
  ): Promise<T>;
  request<T>(method: string, params: unknown): Promise<T>;
};
