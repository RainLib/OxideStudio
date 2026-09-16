import { AgentProtocolError } from "../rpc.js";

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function abortError(): Error {
  const error = new Error("Agent turn cancelled");
  error.name = "AbortError";
  return error;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof AgentProtocolError) return error.message.slice(0, 1_000);
  if (error instanceof Error) return error.message.slice(0, 1_000);
  return "Agent turn failed";
}

export function isRetryable(error: unknown): boolean {
  return !(
    error instanceof AgentProtocolError &&
    [
      "MODEL_TOOL_CALLING_UNSUPPORTED",
      "THREAD_PROJECT_MISMATCH",
      "WORKSPACE_PROJECT_MISMATCH",
    ].includes(error.code)
  );
}
