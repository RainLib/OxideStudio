import { redactSecretString } from "@/lib/redaction";

export type AssistantErrorPresentation = {
  message: string;
  detail: string | null;
};

export function presentAssistantError(options: {
  code?: string | null;
  message?: string | null;
  retryable?: boolean;
}): AssistantErrorPresentation {
  const code = options.code?.trim() ?? "";
  const rawMessage = redactSecretString(options.message?.trim() ?? "");
  const searchable = `${code} ${rawMessage}`.toLowerCase();
  let message: string;

  if (
    /invalid mongodb command shape|mongodb command.*json|mongodb command shape/.test(
      searchable,
    )
  ) {
    message =
      "I couldn't translate that request into a valid read-only MongoDB query. Nothing was changed. Please retry the step.";
  } else if (
    /context version is stale|stale context|workspace.*changed/.test(searchable)
  ) {
    message =
      "The workspace changed while this request was running. Review the active connection, then retry.";
  } else if (
    /multiple database connections|connection_selection_required|which database connection/.test(
      searchable,
    )
  ) {
    message =
      "I need to know which database connection to use before I can continue.";
  } else if (
    /no active connection|connection not found|connection_required|not connected/.test(
      searchable,
    )
  ) {
    message =
      "I couldn't access the selected database connection. Reconnect it or choose another connection, then retry.";
  } else if (
    /\b401\b|unauthorized|invalid api key|authentication failed/.test(
      searchable,
    )
  ) {
    message =
      "The AI provider rejected the configured credentials. Check the API key, endpoint, and selected model in Settings.";
  } else if (
    /tool.?calling.*unsupported|invalid value.*tool_call|model_tool_calling_unsupported/.test(
      searchable,
    )
  ) {
    message =
      "The selected model did not accept the required tool call. Choose a model with tool-calling support, then retry.";
  } else if (/timeout|timed out|deadline exceeded/.test(searchable)) {
    message = options.retryable
      ? "The request took too long. You can resume it without starting over."
      : "The request took too long to complete. Please try again.";
  } else if (/agent turn is not active|turn_not_active/.test(searchable)) {
    message = "This task is no longer active. Start a new request to continue.";
  } else if (/cancelled|canceled|aborted/.test(searchable)) {
    message = "The request was stopped before it completed.";
  } else if (rawMessage && isAlreadyReadable(rawMessage)) {
    message = rawMessage;
  } else {
    message = options.retryable
      ? "I couldn't complete this step. Review the completed steps, then resume the task."
      : "I couldn't complete this request. Review the completed steps, then try again.";
  }

  return {
    message,
    detail: technicalDetail(code, rawMessage, message),
  };
}

function technicalDetail(code: string, rawMessage: string, message: string) {
  const parts = [code, rawMessage].filter(Boolean);
  if (parts.length === 0) return null;
  const detail = parts.join(": ");
  return detail === message ? null : detail;
}

function isAlreadyReadable(message: string) {
  if (
    message.length > 240 ||
    /[{}[\]`]| at \S+\(|\/Users\/|node_modules/.test(message)
  ) {
    return false;
  }
  return /[.!?。！？]$/.test(message) && message.split(/\s+/).length >= 3;
}
