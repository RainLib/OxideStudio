import type {
  DatabaseCapabilities,
  DatabaseDriver,
  CollectionInfo,
  ColumnInfo,
  ConstraintInfo,
  ExplainPlan,
  IndexInfo,
  QueryResult,
  TableInfo,
  TableMutationResult,
  TableRowDelete,
  TableRowUpdate,
} from "@/services/tauri/types";
import type { CompletionItem, Diagnostic } from "@/services/lsp/types";
import type { EditorTextRange } from "@/lib/editorPatch";
import type { WorkspaceContextBinding } from "@/ai/workspaceContext";

export type AiToolPermission = "read" | "write" | "destructive" | "external";

export type AiToolCapability =
  "connection" | "metadata" | "provider" | "query" | "workspace" | "lsp";

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

export type AiToolAuditSink = (entry: AiToolAuditEntry) => Promise<void> | void;

export type AiToolExecutionContext = {
  requestId: string;
  workspaceContext?: WorkspaceContextBinding;
  activeConnectionId?: string | null;
  activeDriver?: DatabaseDriver | null;
  activeNamespace?: string | null;
  activeTab?: AiWorkspaceTabSummary | null;
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
    context: AiToolExecutionContext,
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
  databaseName?: string | null;
  targetSchema?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  objectType?: string | null;
  fileProjectId?: string | null;
  fileRelativePath?: string | null;
  resultSetCount?: number;
  activeResultIndex?: number;
  schemaDiffId?: string | null;
  selectedSchemaChange?: {
    id: string;
    summary: string;
    risk: string;
    relationName: string;
    childName?: string | null;
    phase: string;
    order: number;
    blockedReason?: string | null;
  } | null;
  schemaDiffSummary?: {
    total: number;
    safe: number;
    review: number;
    destructive: number;
    blocked: number;
  } | null;
  schemaPreflightCheckCount?: number;
  selection?: AiWorkspaceSelection | null;
};

export type AiWorkspaceSelection = {
  tabId: string;
  tabTitle: string;
  text: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  connectionId?: string | null;
  databaseName?: string | null;
};

export type AiReadOnlyQueryInput = {
  connectionId?: string | null;
  namespace?: string | null;
  query: string;
  limit?: number;
};

export type AiExplainQueryInput = {
  connectionId?: string | null;
  namespace?: string | null;
  query: string;
};

export type AiMutationQueryInput = {
  connectionId?: string | null;
  namespace?: string | null;
  query: string;
};

export type AiTableMutationInput = {
  connectionId?: string | null;
  namespace?: string | null;
  table: string;
  inserts?: Array<Record<string, unknown>>;
  updates?: TableRowUpdate[];
  deletes?: TableRowDelete[];
};

export type AiDocumentMutationInput = {
  operation: "insert" | "update" | "delete";
  connectionId?: string | null;
  namespace?: string | null;
  collection: string;
  documents?: Array<Record<string, unknown>>;
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
  many?: boolean;
  upsert?: boolean;
};

export type AiKeyValueMutationInput = {
  operation: "set" | "delete";
  connectionId?: string | null;
  namespace?: string | null;
  key?: string;
  keys?: string[];
  value?: unknown;
  ttlSeconds?: number | null;
};

export type AiSearchDocumentMutationInput = {
  operation: "index" | "update" | "delete";
  connectionId?: string | null;
  index: string;
  id?: string | null;
  document?: Record<string, unknown>;
  upsert?: boolean;
};

export type AiLspCompletionInput = {
  connectionId?: string | null;
  uri?: string | null;
  text?: string | null;
  line: number;
  character: number;
  languageId?: string | null;
};

export type AiLspDiagnosticsInput = {
  tabId?: string | null;
  uri?: string | null;
  onlySelection?: boolean;
  severity?: "error" | "warning" | "information" | "hint" | null;
};

export type AiExplainedDiagnostic = Diagnostic & {
  severityLabel: "error" | "warning" | "information" | "hint" | "unknown";
  location: string;
  lineText?: string | null;
  explanation: string;
};

export type AiLspDiagnosticsExplanation = {
  tabId: string;
  tabTitle: string;
  uri?: string | null;
  onlySelection: boolean;
  summary: string;
  diagnostics: AiExplainedDiagnostic[];
};

export type AiEditorPatchInput = {
  tabId?: string | null;
  range?: EditorTextRange | null;
  replacement: string;
  title?: string | null;
  rationale?: string | null;
};

export type AiEditorPatchArtifact = {
  patchId: string;
  tabId: string;
  tabTitle: string;
  range: EditorTextRange;
  originalText: string;
  replacement: string;
  documentRevision: string;
  title: string;
  rationale?: string | null;
};

export type AiNamespaceMutationInput = {
  operation: "create" | "drop";
  connectionId?: string | null;
  namespace: string;
  charset?: string | null;
  collation?: string | null;
  cascade?: boolean;
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

export type AiObjectKind =
  "relation" | "collection" | "key" | "index" | "object";

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
  previewQuery?: string | null;
  deleteQuery?: string | null;
};

export type AiToolAdapters = {
  listConnections: () => Promise<AiConnectionSummary[]> | AiConnectionSummary[];
  getConnectionCapabilities: (
    driver: DatabaseDriver,
  ) => Promise<DatabaseCapabilities> | DatabaseCapabilities;
  getActiveTab?: () =>
    Promise<AiWorkspaceTabSummary | null> | AiWorkspaceTabSummary | null;
  getWorkspaceSelection?: () =>
    Promise<AiWorkspaceSelection | null> | AiWorkspaceSelection | null;
  proposeEditorPatch?: (
    input: AiEditorPatchInput,
    context: AiToolExecutionContext,
  ) => Promise<AiEditorPatchArtifact> | AiEditorPatchArtifact;
  listCollections?: (
    input: { connectionId?: string | null; namespace?: string | null },
    context: AiToolExecutionContext,
  ) => Promise<CollectionInfo[]> | CollectionInfo[];
  listObjects?: (
    input: AiListObjectsInput,
    context: AiToolExecutionContext,
  ) => Promise<AiObjectSummary[]> | AiObjectSummary[];
  describeObject?: (
    input: AiDescribeObjectInput,
    context: AiToolExecutionContext,
  ) => Promise<AiObjectDescription> | AiObjectDescription;
  runReadOnlyQuery?: (
    input: AiReadOnlyQueryInput,
    context: AiToolExecutionContext,
  ) => Promise<QueryResult[]> | QueryResult[];
  explainQuery?: (
    input: AiExplainQueryInput,
    context: AiToolExecutionContext,
  ) => Promise<ExplainPlan> | ExplainPlan;
  runMutationQuery?: (
    input: AiMutationQueryInput,
    context: AiToolExecutionContext,
  ) => Promise<QueryResult[]> | QueryResult[];
  mutateTableRows?: (
    input: AiTableMutationInput,
    context: AiToolExecutionContext,
  ) => Promise<TableMutationResult> | TableMutationResult;
  mutateDocuments?: (
    input: AiDocumentMutationInput,
    context: AiToolExecutionContext,
  ) => Promise<QueryResult[]> | QueryResult[];
  mutateKeyValues?: (
    input: AiKeyValueMutationInput,
    context: AiToolExecutionContext,
  ) => Promise<QueryResult[]> | QueryResult[];
  mutateSearchDocuments?: (
    input: AiSearchDocumentMutationInput,
    context: AiToolExecutionContext,
  ) => Promise<QueryResult[]> | QueryResult[];
  getLspCompletions?: (
    input: AiLspCompletionInput,
    context: AiToolExecutionContext,
  ) => Promise<CompletionItem[]> | CompletionItem[];
  explainLspDiagnostics?: (
    input: AiLspDiagnosticsInput,
    context: AiToolExecutionContext,
  ) => Promise<AiLspDiagnosticsExplanation> | AiLspDiagnosticsExplanation;
  mutateNamespace?: (
    input: AiNamespaceMutationInput,
    context: AiToolExecutionContext,
  ) => Promise<string> | string;
};
