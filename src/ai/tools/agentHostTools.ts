import type { AgentToolManifestEntry } from "@/services/tauri/agent-host.service";

/**
 * Tools executed exclusively by the Rust Agent Host. They intentionally do
 * not live in the browser/CLI registry, because that would create an invoke
 * path around the host's digest-bound one-time approval lease.
 */
export const AGENT_HOST_ONLY_TOOLS: readonly AgentToolManifestEntry[] = [
  {
    name: "query.executeApproved",
    description:
      "Execute exactly one database mutation or DDL statement through OxideStudio after desktop approval. This is available only in Agent mode on development or staging connections. Unclassified, production, and protected databases are always blocked. Read-only work must use query.runReadOnly.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description:
            "Connection id. It must match the connection frozen into the current workspace turn.",
        },
        query: {
          type: "string",
          description:
            "One complete SQL statement or one driver-native operation. Transaction-control statements and multi-operation batches are forbidden.",
        },
        namespace: {
          type: "string",
          description:
            "Optional schema, database, Redis DB, MongoDB database, or Elasticsearch index context frozen for this call.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    permissions: ["write"],
    timeoutMs: 120_000,
    resultLimit: { maxRows: 1_000, maxBytes: 262_144 },
  },
  {
    name: "shell.execute",
    description:
      "Run one non-interactive shell command from the active project. Default to workspace-write: it can write only inside the project and an isolated temporary directory, and network access is denied. Use unrestricted only when the requested task truly needs network access or writes outside the project and the user has explicitly requested that broader access. Every invocation requires a one-time approval bound to the exact command input.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The exact non-interactive shell command. Do not use commands that wait for prompts.",
        },
        cwd: {
          type: "string",
          description:
            "Optional project-relative working directory. Defaults to the project root and cannot escape it.",
        },
        sandboxMode: {
          type: "string",
          enum: ["workspace-write", "unrestricted"],
          description:
            "Execution boundary. Omit for workspace-write. Unrestricted is only appropriate when the user explicitly asks to leave the sandbox.",
        },
        timeoutMs: {
          type: "number",
          description:
            "Optional timeout from 1,000 to 120,000 milliseconds. Defaults to 30,000.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    permissions: ["external"],
    timeoutMs: 120_000,
    resultLimit: { maxRows: 1, maxBytes: 270_000 },
  },
] as const;
