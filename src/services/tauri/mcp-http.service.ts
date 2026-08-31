import { invokeRawCommand } from "./client";

export const PUBLIC_MCP_TOOLS = [
  {
    name: "connection.listSummaries",
    title: "Connection summaries",
    description: "Sanitized connection names, drivers, hosts, and databases.",
  },
  {
    name: "metadata.listObjects",
    title: "Cached metadata",
    description: "Bounded object metadata from the selected project and connection.",
  },
  {
    name: "query.runReadOnly",
    title: "Read-only query",
    description: "Backend-validated SELECT/VALUES queries with row and byte limits.",
  },
  {
    name: "query.explainEstimate",
    title: "Estimated query plan",
    description: "Estimated EXPLAIN only; EXPLAIN ANALYZE is unavailable.",
  },
  {
    name: "lsp.sqlContext",
    title: "SQL completion context",
    description: "Headless SQL parsing and bounded cached completion candidates.",
  },
] as const;

export type PublicMcpToolName = (typeof PUBLIC_MCP_TOOLS)[number]["name"];

export type McpHttpServerSettings = {
  enabled: boolean;
  host: string;
  port: number;
  path: string;
  allowRemote: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
  projectId: string;
  connectionId?: string | null;
  databases: string[];
  tools: string[];
  maxRows: number;
  maxResultBytes: number;
  queryTimeoutSecs?: number | null;
};

export type McpHttpServerStatus = {
  enabled: boolean;
  running: boolean;
  endpoint?: string | null;
  accessToken?: string | null;
  lastError?: string | null;
  recentLogs: string[];
};

export const mcpHttpService = {
  loadSettings: () =>
    invokeRawCommand<McpHttpServerSettings>(
      "load_mcp_http_server_settings",
    ),
  saveSettings: (settings: McpHttpServerSettings) =>
    invokeRawCommand<McpHttpServerStatus>("save_mcp_http_server_settings", {
      settings,
    }),
  status: () =>
    invokeRawCommand<McpHttpServerStatus>("mcp_http_server_status"),
  rotateToken: () =>
    invokeRawCommand<McpHttpServerStatus>("rotate_mcp_http_server_token"),
};
