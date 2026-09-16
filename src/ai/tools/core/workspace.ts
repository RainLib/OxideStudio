import { assertObject, optionalString } from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function activeTabTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "workspace.getActiveTab",
    description:
      "Return the active editor tab metadata, current query text, and a bounded normalized Explain Plan when one is open. An analyzed plan contains user-approved actual timing, rows, and loops.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    execute: async () => adapters.getActiveTab?.() ?? null,
  };
}

export function workspaceSelectionTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "workspace.getSelection",
    description:
      "Return the current editor selection for the active workspace tab.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    execute: async () => adapters.getWorkspaceSelection?.() ?? null,
  };
}

export function editorPatchTool(adapters: AiToolAdapters): AiToolDefinition {
  const positionProperties = {
    startLine: { type: "integer", description: "One-based start line." },
    startColumn: { type: "integer", description: "One-based start column." },
    endLine: { type: "integer", description: "One-based end line." },
    endColumn: { type: "integer", description: "One-based end column." },
  };
  return {
    name: "editor.proposePatch",
    description:
      "Create a revision-bound before/after patch preview for the active SQL editor. This never edits the document; the user must open and apply the preview.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "Defaults to the active tab." },
        range: {
          type: "object",
          properties: positionProperties,
          required: ["startLine", "startColumn", "endLine", "endColumn"],
          additionalProperties: false,
          description:
            "Optional one-based replacement range. Defaults to the current selection, then the whole document.",
        },
        replacement: {
          type: "string",
          description:
            "Exact replacement text. An empty string proposes deletion.",
        },
        title: { type: "string", description: "Short review title." },
        rationale: {
          type: "string",
          description: "Why this patch is proposed.",
        },
      },
      required: ["replacement"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    resultLimit: { maxRows: 1, maxBytes: 450_000 },
    execute: async (input, context) => {
      const payload = assertObject(input);
      const replacement = payload.replacement;
      if (typeof replacement !== "string") {
        throw new Error("replacement is required");
      }
      return adapters.proposeEditorPatch?.(
        {
          tabId: optionalString(payload, "tabId"),
          range:
            payload.range && typeof payload.range === "object"
              ? (payload.range as {
                  startLine: number;
                  startColumn: number;
                  endLine: number;
                  endColumn: number;
                })
              : null,
          replacement,
          title: optionalString(payload, "title"),
          rationale: optionalString(payload, "rationale"),
        },
        context,
      );
    },
  };
}
