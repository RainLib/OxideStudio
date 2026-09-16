import {
  assertObject,
  optionalBoolean,
  optionalString,
  requireNonNegativeInteger,
} from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function lspCompletionsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "lsp.getCompletions",
    description: "Return LSP completions for a document position.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        uri: {
          type: "string",
          description:
            "Optional document URI. Defaults to the active query tab URI.",
        },
        text: {
          type: "string",
          description:
            "Optional document text. Defaults to the active query text.",
        },
        line: {
          type: "number",
          description: "Zero-based line number.",
        },
        character: {
          type: "number",
          description: "Zero-based character offset.",
        },
        languageId: {
          type: "string",
          description:
            "Optional LSP language id. Defaults to the active driver dialect.",
        },
      },
      required: ["line", "character"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["lsp"],
    timeoutMs: 10_000,
    resultLimit: {
      maxRows: 100,
      maxBytes: 100_000,
    },
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.getLspCompletions?.(
        {
          connectionId: optionalString(payload, "connectionId"),
          uri: optionalString(payload, "uri"),
          text: typeof payload.text === "string" ? payload.text : null,
          line: requireNonNegativeInteger(payload, "line"),
          character: requireNonNegativeInteger(payload, "character"),
          languageId: optionalString(payload, "languageId"),
        },
        context,
      );
    },
  };
}

export function lspExplainDiagnosticsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "lsp.explainDiagnostics",
    description: "Explain current LSP diagnostics for the active editor tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "string",
          description: "Optional tab id. Defaults to the active tab.",
        },
        uri: {
          type: "string",
          description: "Optional LSP document URI.",
        },
        onlySelection: {
          type: "boolean",
          description:
            "When true, only include diagnostics overlapping the current selection.",
        },
        severity: {
          type: "string",
          enum: ["error", "warning", "information", "hint"],
          description: "Optional severity filter.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["lsp"],
    timeoutMs: 5_000,
    resultLimit: {
      maxRows: 100,
      maxBytes: 100_000,
    },
    execute: async (input, context) => {
      const payload = assertObject(input);
      const severity = optionalString(payload, "severity");
      if (
        severity &&
        !["error", "warning", "information", "hint"].includes(severity)
      ) {
        throw new Error(
          "severity must be error, warning, information, or hint",
        );
      }

      return adapters.explainLspDiagnostics?.(
        {
          tabId: optionalString(payload, "tabId"),
          uri: optionalString(payload, "uri"),
          onlySelection: optionalBoolean(payload, "onlySelection") ?? false,
          severity: severity as
            | "error"
            | "warning"
            | "information"
            | "hint"
            | null,
        },
        context,
      );
    },
  };
}
