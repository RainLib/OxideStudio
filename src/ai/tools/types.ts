import type {
  DatabaseCapabilities,
  DatabaseDriver,
  QueryResult,
} from "@/services/tauri/types";

export type AiToolPermission = "read" | "write" | "destructive" | "external";

export type AiToolCapability =
  | "connection"
  | "metadata"
  | "query"
  | "workspace"
  | "lsp";

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean | JsonSchema;
};

export type AiToolResultLimit = {
  maxRows?: number;
  maxBytes?: number;
};

export type AiToolExecutionContext = {
  requestId: string;
  activeConnectionId?: string | null;
  activeDriver?: DatabaseDriver | null;
  abortSignal?: AbortSignal;
};

export type AiToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  permissions: AiToolPermission[];
  capabilities: AiToolCapability[];
  timeoutMs?: number;
  resultLimit?: AiToolResultLimit;
  execute: (
    input: TInput,
    context: AiToolExecutionContext
  ) => Promise<TOutput> | TOutput;
};

export type AiToolSummary = Omit<AiToolDefinition, "execute">;

export type AiConnectionSummary = {
  id: string;
  name: string;
  driver: DatabaseDriver;
  capabilities?: DatabaseCapabilities;
};

export type AiWorkspaceTabSummary = {
  id: string;
  type: string;
  title: string;
  sql?: string;
  connectionId?: string | null;
};

export type AiReadOnlyQueryInput = {
  connectionId?: string | null;
  query: string;
  limit?: number;
};

export type AiToolAdapters = {
  listConnections: () => Promise<AiConnectionSummary[]> | AiConnectionSummary[];
  getConnectionCapabilities: (
    driver: DatabaseDriver
  ) => Promise<DatabaseCapabilities> | DatabaseCapabilities;
  getActiveTab?: () => Promise<AiWorkspaceTabSummary | null> | AiWorkspaceTabSummary | null;
  runReadOnlyQuery?: (
    input: AiReadOnlyQueryInput,
    context: AiToolExecutionContext
  ) => Promise<QueryResult[]> | QueryResult[];
};
