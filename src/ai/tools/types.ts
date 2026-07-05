import type {
  DatabaseCapabilities,
  DatabaseDriver,
  CollectionInfo,
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  QueryResult,
  TableInfo,
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

export type AiToolExecutionPolicy = {
  allowPermissions?: AiToolPermission[];
  requireApprovalFor?: AiToolPermission[];
  approvedTools?: string[];
  deniedTools?: string[];
};

export type AiToolPolicyDecision = {
  toolName: string;
  allowed: boolean;
  requiresApproval: boolean;
  permissions: AiToolPermission[];
  reason?: string;
};

export type AiToolAuditEntry = {
  requestId: string;
  toolName: string;
  permissions: AiToolPermission[];
  status: "success" | "error" | "blocked";
  startedAt: number;
  durationMs: number;
  reason?: string;
};

export type AiToolAuditSink = (
  entry: AiToolAuditEntry
) => Promise<void> | void;

export type AiToolExecutionContext = {
  requestId: string;
  activeConnectionId?: string | null;
  activeDriver?: DatabaseDriver | null;
  abortSignal?: AbortSignal;
  audit?: AiToolAuditSink;
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

export type AiDescribeObjectInput = {
  connectionId?: string | null;
  namespace?: string | null;
  name: string;
};

export type AiListObjectsInput = {
  connectionId?: string | null;
  namespace?: string | null;
};

export type AiObjectKind = "relation" | "collection" | "key" | "index" | "object";

export type AiObjectSummary = {
  name: string;
  namespace?: string | null;
  kind: AiObjectKind;
  type?: string | null;
  comment?: string | null;
  documentCount?: number | null;
  table?: TableInfo;
  collection?: CollectionInfo;
};

export type AiObjectDescription = {
  connectionId: string;
  namespace: string;
  name: string;
  driver?: DatabaseDriver | null;
  kind: AiObjectKind;
  collection?: CollectionInfo | null;
  columns?: ColumnInfo[];
  indexes?: IndexInfo[];
  constraints?: ConstraintInfo[];
};

export type AiToolAdapters = {
  listConnections: () => Promise<AiConnectionSummary[]> | AiConnectionSummary[];
  getConnectionCapabilities: (
    driver: DatabaseDriver
  ) => Promise<DatabaseCapabilities> | DatabaseCapabilities;
  getActiveTab?: () => Promise<AiWorkspaceTabSummary | null> | AiWorkspaceTabSummary | null;
  listCollections?: (
    input: { connectionId?: string | null; namespace?: string | null },
    context: AiToolExecutionContext
  ) => Promise<CollectionInfo[]> | CollectionInfo[];
  listObjects?: (
    input: AiListObjectsInput,
    context: AiToolExecutionContext
  ) => Promise<AiObjectSummary[]> | AiObjectSummary[];
  describeObject?: (
    input: AiDescribeObjectInput,
    context: AiToolExecutionContext
  ) => Promise<AiObjectDescription> | AiObjectDescription;
  runReadOnlyQuery?: (
    input: AiReadOnlyQueryInput,
    context: AiToolExecutionContext
  ) => Promise<QueryResult[]> | QueryResult[];
};
