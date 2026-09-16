import { assertObject, optionalString } from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function projectListFilesTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "project.listFiles",
    description:
      "List up to 500 entries in a directory under the active project root. Paths are project-relative and cannot escape the project.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description:
            "Optional project-relative directory. Defaults to the project root.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    resultLimit: { maxRows: 500, maxBytes: 256_000 },
    execute: async (input) =>
      adapters.listProjectFiles?.(
        assertObject(input) as { directory?: string | null },
      ) ?? [],
  };
}

export function projectReadFileTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "project.readFile",
    description:
      "Read one UTF-8 text file under the active project root and return its content revision. Files are limited to 256 KiB.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["workspace"],
    timeoutMs: 5_000,
    resultLimit: { maxRows: 1, maxBytes: 300_000 },
    execute: async (input) => {
      const payload = assertObject(input);
      const path = optionalString(payload, "path");
      if (!path) throw new Error("path is required");
      return adapters.readProjectFile?.({ path }) ?? null;
    },
  };
}

export function projectWriteFileTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "project.writeFile",
    description:
      "Create or atomically replace one UTF-8 file under the active project root. The change is written immediately and remains available in the Git-style review UI for Keep or Undo. Replacements require the exact expectedRevision returned by project.readFile.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path." },
        content: {
          type: "string",
          description: "Complete replacement content.",
        },
        expectedRevision: {
          type: "string",
          description:
            "Required for replacement; omit only when create is true.",
        },
        create: {
          type: "boolean",
          description: "Create a new file and fail if it already exists.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    permissions: ["write"],
    capabilities: ["workspace"],
    timeoutMs: 10_000,
    resultLimit: { maxRows: 1, maxBytes: 8_000 },
    execute: async (input) => {
      const payload = assertObject(input);
      const path = optionalString(payload, "path");
      if (!path || typeof payload.content !== "string") {
        throw new Error("path and content are required");
      }
      return adapters.writeProjectFile?.({
        path,
        content: payload.content,
        expectedRevision: optionalString(payload, "expectedRevision"),
        create: payload.create === true,
      });
    },
  };
}
