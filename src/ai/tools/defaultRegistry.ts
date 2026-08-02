import {
  databaseService,
  projectFilesService,
  queryService,
  schemaService,
  tableService,
} from "@/services/tauri";
import {
  ensureLspSession,
  extractSqlDocumentTabId,
  getLspDocumentUri,
} from "@/services/lsp";
import type { Diagnostic } from "@/services/lsp/types";
import type {
  DatabaseDataModel,
  DatabaseDriver,
  ExplainPlan,
  QueryResult,
} from "@/services/tauri/types";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useProjectStore } from "@/store/useProjectStore";
import {
  querySchemaContextForTab,
  useTabStore,
  type EditorSelectionState,
} from "@/store/useTabStore";
import {
  lspLanguageIdForCapabilities,
  normalizeDatabaseDriverName,
  previewTableQuery,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import {
  collectionDeleteQueryTemplateForCapabilities,
  collectionPreviewQueryTemplateForCapabilities,
} from "@/lib/databaseObjectPreview";
import {
  buildElasticsearchMutationRequest,
  buildMongoMutationCommand,
  buildRedisMutationCommand,
} from "./nativeMutationBuilders";
import { registerCoreAiTools } from "./coreTools";
import { createAiToolRegistry } from "./registry";
import type { AiToolFamily } from "./families";
import type {
  AiDescribeObjectInput,
  AiEditorPatchArtifact,
  AiEditorPatchInput,
  AiDocumentMutationInput,
  AiKeyValueMutationInput,
  AiListObjectsInput,
  AiLspCompletionInput,
  AiLspDiagnosticsExplanation,
  AiLspDiagnosticsInput,
  AiNamespaceMutationInput,
  AiObjectDescription,
  AiObjectKind,
  AiObjectSummary,
  AiSearchDocumentMutationInput,
  AiTableMutationInput,
  AiToolAdapters,
  AiToolExecutionContext,
  AiExplainedDiagnostic,
  AiWorkspaceSelection,
  AiWorkspaceTabSummary,
} from "./types";
import {
  fullDocumentRange,
  textInEditorRange,
  type EditorTextRange,
} from "@/lib/editorPatch";
import { documentTextRevision } from "@/lib/documentRevision";
import { captureWorkspaceUiActionContext } from "@/ai/ui-actions/context";
import { createWorkspaceContextBinding } from "@/ai/workspaceContext";

export type WorkspaceAiToolRegistryOptions = {
  families?: AiToolFamily[];
};

export function createWorkspaceAiToolRegistry(
  options: WorkspaceAiToolRegistryOptions = {},
) {
  return registerCoreAiTools(
    createAiToolRegistry(),
    createWorkspaceAiToolAdapters(),
    options.families,
  );
}

export function createWorkspaceAiToolContext(
  requestId: string = createRequestId(),
): AiToolExecutionContext {
  const connectionState = useConnectionStore.getState();
  const schemaState = useSchemaStore.getState();
  const tabState = useTabStore.getState();
  const activeConnection = connectionState.connections.find(
    (connection) => connection.id === connectionState.activeConnectionId,
  );
  const authorizedLocalConnection =
    activeConnection && !isManagedConnection(activeConnection)
      ? activeConnection
      : null;
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );

  return {
    requestId,
    workspaceContext: createWorkspaceContextBinding(
      captureWorkspaceUiActionContext(),
    ),
    activeConnectionId: authorizedLocalConnection?.id ?? null,
    activeDriver: authorizedLocalConnection?.driver ?? null,
    activeNamespace: schemaState.currentSchema,
    activeTab: activeTab ? workspaceTabSummaryFromTab(activeTab) : null,
  };
}

export function createWorkspaceAiToolAdapters(): AiToolAdapters {
  return {
    listProjectFiles: async (input) => {
      const project = activeLocalProject();
      return projectFilesService.listProjectEntries(
        project.id,
        input.directory || "",
        project.root_path,
      );
    },

    readProjectFile: async (input) => {
      const project = activeLocalProject();
      return projectFilesService.readProjectFile(
        project.id,
        input.path,
        project.root_path,
      );
    },

    writeProjectFile: async (input) => {
      const project = activeLocalProject();
      return input.create
        ? projectFilesService.createProjectFile(
            project.id,
            input.path,
            input.content,
            project.root_path,
          )
        : projectFilesService.writeProjectFile(
            project.id,
            input.path,
            input.content,
            input.expectedRevision || "",
            project.root_path,
          );
    },

    listConnections: () =>
      useConnectionStore
        .getState()
        .connections.filter((connection) => !isManagedConnection(connection))
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          driver: connection.driver,
        })),

    getConnectionCapabilities: (driver, connectionId) => {
      const connection = connectionId
        ? useConnectionStore
            .getState()
            .connections.find((candidate) => candidate.id === connectionId)
        : undefined;
      return databaseService.getDatabaseCapabilities(
        driver,
        connection?.driverPackageVersion,
      );
    },

    getActiveTab: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find(
        (tab) => tab.id === tabState.activeTabId,
      );
      return activeTab ? workspaceTabSummaryFromTab(activeTab) : null;
    },

    getWorkspaceSelection: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find(
        (tab) => tab.id === tabState.activeTabId,
      );
      return activeTab ? workspaceSelectionFromTab(activeTab) : null;
    },

    proposeEditorPatch: (input) => proposeEditorPatch(input),

    listCollections: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error(
          "No active connection is available for metadata.listCollections",
        );
      }
      requireLocalAiConnection(connectionId);
      const namespace =
        input.namespace || useSchemaStore.getState().currentSchema || "";
      return schemaService.getCollections(connectionId, namespace);
    },

    listObjects: async (input, context) => listObjects(input, context),

    describeObject: async (input, context) => describeObject(input, context),

    runReadOnlyQuery: async (input, context) => {
      const { connectionId, namespace, driver } = resolveQueryExecutionTarget(
        input.connectionId,
        input.namespace,
        context,
        "query.runReadOnly",
      );

      const results = await executeReadOnlyWorkspaceQuery(
        connectionId,
        input.query,
        namespace,
        driver,
        context,
      );
      return limitQueryResults(results, input.limit ?? 200);
    },

    explainQuery: async (input, context) =>
      executeWorkspaceExplainPlan(input, context),

    runMutationQuery: async (input, context) => {
      const { connectionId, namespace } = resolveQueryExecutionTarget(
        input.connectionId,
        input.namespace,
        context,
        "mutation query",
      );

      return executeWorkspaceQuery(
        connectionId,
        input.query,
        namespace,
        context,
        "query.runMutation",
      );
    },

    mutateTableRows: async (input, context) => mutateTableRows(input, context),

    mutateDocuments: async (input, context) => mutateDocuments(input, context),

    mutateKeyValues: async (input, context) => mutateKeyValues(input, context),

    mutateSearchDocuments: async (input, context) =>
      mutateSearchDocuments(input, context),

    getLspCompletions: async (input, context) =>
      getLspCompletions(input, context),

    explainLspDiagnostics: async (input, context) =>
      explainLspDiagnostics(input, context),

    mutateNamespace: async (input, context) => mutateNamespace(input, context),
  };
}

function activeLocalProject() {
  const state = useProjectStore.getState();
  const project = state.projects.find(
    (candidate) => candidate.id === state.activeProjectId,
  );
  if (!project?.root_path || project.origin === "managed") {
    throw new Error("The active project does not have a writable local root");
  }
  return project;
}

const MAX_EDITOR_PATCH_TEXT = 50_000;

function proposeEditorPatch(input: AiEditorPatchInput): AiEditorPatchArtifact {
  const tabState = useTabStore.getState();
  const tabId = input.tabId || tabState.activeTabId;
  const tab = tabState.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.type !== "query" || tab.filePreview) {
    throw new Error("A writable SQL editor tab is required for a patch proposal");
  }
  const range: EditorTextRange =
    input.range ||
    (tab.editorSelection
      ? {
          startLine: tab.editorSelection.startLineNumber,
          startColumn: tab.editorSelection.startColumn,
          endLine: tab.editorSelection.endLineNumber,
          endColumn: tab.editorSelection.endColumn,
        }
      : fullDocumentRange(tab.sql));
  const originalText = textInEditorRange(tab.sql, range);
  if (originalText === null) throw new Error("Patch range is outside the editor document");
  if (
    originalText.length > MAX_EDITOR_PATCH_TEXT ||
    input.replacement.length > MAX_EDITOR_PATCH_TEXT
  ) {
    throw new Error(
      "Patch text exceeds 50,000 characters; select a narrower editor range",
    );
  }
  const revision = documentTextRevision(tab.fileRevision, tab.sql);
  return {
    patchId: `patch-${createRequestId()}`,
    tabId: tab.id,
    tabTitle: tab.title,
    range,
    originalText,
    replacement: input.replacement,
    documentRevision: revision,
    title: input.title?.trim().slice(0, 160) || "AI SQL patch",
    rationale: input.rationale?.trim().slice(0, 2_000) || null,
  };
}

function workspaceSelectionFromTab(tab: {
  id: string;
  title: string;
  connectionId?: string | null;
  databaseName?: string | null;
  editorSelection?: {
    text: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}): AiWorkspaceSelection | null {
  if (!tab.editorSelection?.text.trim()) return null;
  return {
    tabId: tab.id,
    tabTitle: tab.title,
    text: tab.editorSelection.text,
    startLineNumber: tab.editorSelection.startLineNumber,
    startColumn: tab.editorSelection.startColumn,
    endLineNumber: tab.editorSelection.endLineNumber,
    endColumn: tab.editorSelection.endColumn,
    connectionId: tab.connectionId ?? null,
    databaseName: tab.databaseName ?? null,
  };
}

function workspaceTabSummaryFromTab(tab: {
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
  results?: unknown[] | null;
  activeResultIndex?: number;
  queryError?: import("@/lib/queryErrorPresentation").QueryExecutionErrorDetail | null;
  explainPlan?: ExplainPlan | null;
  schemaDiffPlan?: {
    id: string;
    summary: {
      total: number;
      safe: number;
      review: number;
      destructive: number;
      blocked: number;
    };
    changes: Array<{
      id: string;
      summary: string;
      risk: string;
      relationName: string;
      childName?: string | null;
      phase: string;
      order: number;
      blockedReason?: string | null;
    }>;
    preflightChecks: Array<unknown>;
  };
  selectedSchemaChangeId?: string | null;
  editorSelection?: {
    text: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}): AiWorkspaceTabSummary {
  return {
    id: tab.id,
    type: tab.type,
    title: tab.title,
    sql: tab.sql,
    connectionId: tab.connectionId ?? null,
    databaseName: tab.databaseName ?? null,
    targetSchema: tab.targetSchema ?? null,
    schemaName: tab.schemaName ?? null,
    tableName: tab.tableName ?? null,
    objectType: tab.objectType ?? null,
    fileProjectId: tab.fileProjectId ?? null,
    fileRelativePath: tab.fileRelativePath ?? null,
    resultSetCount: tab.results?.length ?? 0,
    activeResultIndex: tab.activeResultIndex ?? 0,
    queryError: tab.queryError ?? null,
    explainPlan: tab.explainPlan
      ? boundedAiExplainPlanSummary(tab.explainPlan)
      : null,
    schemaDiffId: tab.schemaDiffPlan?.id ?? null,
    schemaDiffSummary: tab.schemaDiffPlan?.summary ?? null,
    schemaPreflightCheckCount: tab.schemaDiffPlan?.preflightChecks.length ?? 0,
    selectedSchemaChange:
      tab.schemaDiffPlan?.changes.find(
        (change) => change.id === tab.selectedSchemaChangeId,
      ) ?? null,
    selection: workspaceSelectionFromTab(tab),
  };
}

const MAX_AI_EXPLAIN_NODES = 100;
const MAX_AI_EXPLAIN_WARNINGS = 3;

function boundedAiExplainPlanSummary(
  plan: ExplainPlan,
): NonNullable<AiWorkspaceTabSummary["explainPlan"]> {
  const nodes: NonNullable<
    AiWorkspaceTabSummary["explainPlan"]
  >["nodes"] = [];
  const pending = [{ node: plan.root, parentId: null as string | null }];
  while (pending.length > 0 && nodes.length < MAX_AI_EXPLAIN_NODES) {
    const current = pending.shift()!;
    nodes.push({
      id: boundedPlanText(current.node.id, 240),
      parentId: current.parentId,
      nodeType: boundedPlanText(current.node.nodeType, 160),
      relation: boundedNullablePlanText(current.node.relation, 240),
      index: boundedNullablePlanText(current.node.index, 240),
      totalCost: finitePlanMetric(current.node.totalCost),
      estimatedRows: finitePlanMetric(current.node.estimatedRows),
      actualTotalTimeMs: finitePlanMetric(current.node.actualTotalTimeMs),
      actualRows: finitePlanMetric(current.node.actualRows),
      loops: finitePlanMetric(current.node.loops),
    });
    pending.push(
      ...current.node.children.map((node) => ({
        node,
        parentId: current.node.id,
      })),
    );
  }
  return {
    id: boundedPlanText(plan.id, 240),
    driver: plan.driver,
    mode: plan.mode,
    generatedInMs: finitePlanMetric(plan.generatedInMs) ?? 0,
    planningTimeMs: finitePlanMetric(plan.planningTimeMs),
    executionTimeMs: finitePlanMetric(plan.executionTimeMs),
    totalCost: finitePlanMetric(plan.totalCost),
    estimatedRows: finitePlanMetric(plan.estimatedRows),
    rootNodeId: boundedPlanText(plan.root.id, 240),
    nodes,
    truncated: pending.length > 0,
    warnings: plan.warnings
      .slice(0, MAX_AI_EXPLAIN_WARNINGS)
      .map((warning) => boundedPlanText(warning, 240)),
  };
}

function boundedPlanText(value: string, maxCharacters: number) {
  return value.trim().slice(0, maxCharacters);
}

function boundedNullablePlanText(
  value: string | null | undefined,
  maxCharacters: number,
) {
  const bounded = value ? boundedPlanText(value, maxCharacters) : "";
  return bounded || null;
}

function finitePlanMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function mutateTableRows(
  input: AiTableMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "table.mutateRows",
    );
  if (!capabilities.supportsTableBrowsing) {
    throw new Error(
      `${capabilities.displayName} does not support table row mutation`,
    );
  }

  return tableService.mutateTableRows(
    connectionId,
    driver,
    namespace,
    input.table,
    input.inserts ?? [],
    input.updates ?? [],
    input.deletes ?? [],
  );
}

async function mutateDocuments(
  input: AiDocumentMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "document.mutate",
  );
  if (capabilities.dataModel !== "document") {
    throw new Error(
      `${capabilities.displayName} does not support document mutation`,
    );
  }

  return executeWorkspaceQuery(
    connectionId,
    JSON.stringify(buildMongoMutationCommand(input, namespace)),
    undefined,
    context,
    "document.mutate",
    false,
  );
}

async function mutateKeyValues(
  input: AiKeyValueMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "key.mutate",
  );
  if (capabilities.dataModel !== "keyValue") {
    throw new Error(
      `${capabilities.displayName} does not support key-value mutation`,
    );
  }

  return executeWorkspaceQuery(
    connectionId,
    buildRedisMutationCommand(input),
    namespace || undefined,
    context,
    "key.mutate",
  );
}

async function mutateSearchDocuments(
  input: AiSearchDocumentMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "search.mutate",
  );
  if (capabilities.dataModel !== "search") {
    throw new Error(
      `${capabilities.displayName} does not support search document mutation`,
    );
  }

  return executeWorkspaceQuery(
    connectionId,
    buildElasticsearchMutationRequest(input),
    undefined,
    context,
    "search.mutate",
    false,
  );
}

async function getLspCompletions(
  input: AiLspCompletionInput,
  context: AiToolExecutionContext,
) {
  const connectionId = input.connectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error("No active connection is available for lsp.getCompletions");
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  if (connection && isManagedConnection(connection)) {
    throw new Error(
      "Managed AI access requires an organization ai.use grant and an enterprise Gateway session.",
    );
  }
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }
  const capabilities = await databaseService.getDatabaseCapabilities(
    driver,
    connection?.driverPackageVersion,
  );
  if (!supportsLspCapabilities(capabilities)) {
    throw new Error(`${driver} does not support LSP completions`);
  }

  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );
  const languageId =
    input.languageId || lspLanguageIdForCapabilities(capabilities);
  const uri =
    input.uri ||
    (activeTab
      ? getLspDocumentUri(activeTab.id, driver, languageId)
      : getLspDocumentUri(context.requestId, driver, languageId));
  const text = input.text ?? activeTab?.sql ?? "";
  const descriptor = await ensureLspSession({
    connectionId,
    driver,
    capabilities,
  });
  if (!descriptor) {
    throw new Error(`${driver} does not have an enabled built-in LSP profile`);
  }

  await descriptor.client.didOpen(uri, text, Date.now(), languageId);
  return descriptor.client.getCompletions(uri, input.line, input.character);
}

async function explainLspDiagnostics(
  input: AiLspDiagnosticsInput,
  _context: AiToolExecutionContext,
): Promise<AiLspDiagnosticsExplanation> {
  const tabState = useTabStore.getState();
  const tabId =
    input.tabId ||
    (input.uri ? extractSqlDocumentTabId(input.uri) : null) ||
    tabState.activeTabId;
  const tab = tabState.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    throw new Error("No active tab is available for lsp.explainDiagnostics");
  }

  const selection = input.onlySelection ? (tab.editorSelection ?? null) : null;
  const diagnostics = (tab.lspDiagnostics ?? [])
    .filter((diagnostic) =>
      input.severity
        ? diagnosticSeverityLabel(diagnostic.severity) === input.severity
        : true,
    )
    .filter((diagnostic) =>
      selection ? diagnosticOverlapsSelection(diagnostic, selection) : true,
    );
  const lines = tab.sql.split(/\r?\n/);
  const explained = diagnostics.map((diagnostic) =>
    explainDiagnostic(diagnostic, lines),
  );

  return {
    tabId: tab.id,
    tabTitle: tab.title,
    uri: input.uri ?? null,
    onlySelection: Boolean(selection),
    summary: diagnosticsSummary(
      explained,
      Boolean(selection),
      input.severity ?? null,
    ),
    diagnostics: explained,
  };
}

function explainDiagnostic(
  diagnostic: Diagnostic,
  lines: string[],
): AiExplainedDiagnostic {
  const severityLabel = diagnosticSeverityLabel(diagnostic.severity);
  const lineNumber = diagnostic.range.start.line + 1;
  const startColumn = diagnostic.range.start.character + 1;
  const endLineNumber = diagnostic.range.end.line + 1;
  const endColumn = diagnostic.range.end.character + 1;
  const lineText = lines[lineNumber - 1] ?? null;

  return {
    ...diagnostic,
    severityLabel,
    location:
      lineNumber === endLineNumber
        ? `line ${lineNumber}, columns ${startColumn}-${endColumn}`
        : `lines ${lineNumber}-${endLineNumber}`,
    lineText,
    explanation: diagnosticExplanation(diagnostic.message, severityLabel),
  };
}

function diagnosticSeverityLabel(
  severity: number | undefined,
): AiExplainedDiagnostic["severityLabel"] {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  if (severity === 3) return "information";
  if (severity === 4) return "hint";
  return "unknown";
}

function diagnosticExplanation(
  message: string,
  severity: ReturnType<typeof diagnosticSeverityLabel>,
) {
  if (severity === "error") {
    return `The LSP reported a blocking syntax or semantic problem: ${message}`;
  }
  if (severity === "warning") {
    return `The LSP reported a likely issue that may still execute: ${message}`;
  }
  if (severity === "information") {
    return `The LSP reported an informational note: ${message}`;
  }
  if (severity === "hint") {
    return `The LSP suggested an editor hint: ${message}`;
  }
  return `The LSP reported: ${message}`;
}

function diagnosticsSummary(
  diagnostics: AiExplainedDiagnostic[],
  onlySelection: boolean,
  severity: string | null,
) {
  const scope = onlySelection ? "selection" : "active tab";
  const filter = severity ? ` ${severity}` : "";
  if (diagnostics.length === 0) {
    return `No${filter} LSP diagnostics found for the ${scope}.`;
  }

  const counts = diagnostics.reduce<Record<string, number>>(
    (acc, diagnostic) => {
      acc[diagnostic.severityLabel] = (acc[diagnostic.severityLabel] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const countText = Object.entries(counts)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
  return `Found ${diagnostics.length} LSP diagnostic(s) for the ${scope}: ${countText}.`;
}

function diagnosticOverlapsSelection(
  diagnostic: Diagnostic,
  selection: EditorSelectionState,
) {
  const diagnosticStart = {
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
  };
  const diagnosticEnd = {
    line: diagnostic.range.end.line + 1,
    column: diagnostic.range.end.character + 1,
  };
  const selectionStart = {
    line: selection.startLineNumber,
    column: selection.startColumn,
  };
  const selectionEnd = {
    line: selection.endLineNumber,
    column: selection.endColumn,
  };

  return (
    comparePosition(diagnosticEnd, selectionStart) >= 0 &&
    comparePosition(diagnosticStart, selectionEnd) <= 0
  );
}

function comparePosition(
  left: { line: number; column: number },
  right: { line: number; column: number },
) {
  if (left.line !== right.line) return left.line - right.line;
  return left.column - right.column;
}

async function mutateNamespace(
  input: AiNamespaceMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, driver, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "database.mutateNamespace",
  );

  if (input.operation === "create") {
    if (!capabilities.supportsCreateDatabase) {
      throw new Error(
        `${capabilities.displayName} does not support namespace creation`,
      );
    }
    return databaseService.createDatabase(
      connectionId,
      driver,
      input.namespace,
      input.charset ?? undefined,
      input.collation ?? undefined,
    );
  }

  if (!capabilities.supportsCreateDatabase) {
    throw new Error(
      `${capabilities.displayName} does not support namespace deletion`,
    );
  }
  return databaseService.dropDatabase(
    connectionId,
    driver,
    input.namespace,
    input.cascade ?? false,
  );
}

async function listObjects(
  input: AiListObjectsInput,
  context: AiToolExecutionContext,
): Promise<AiObjectSummary[]> {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "metadata.listObjects",
  );

  if (capabilities.supportsTableBrowsing) {
    const tables = await schemaService.getTables(connectionId, namespace);
    return tables.map((table) => ({
      name: table.name,
      namespace: table.schema || namespace,
      kind: "relation",
      type: table.type || null,
      comment: table.comment || null,
      table,
    }));
  }

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    const collections = await schemaService.getCollections(
      connectionId,
      namespace,
    );
    const kind = collectionKind(capabilities.dataModel);
    return collections.map((collection) => ({
      name: collection.name,
      namespace: collection.namespace || namespace,
      kind,
      type: collection.type || null,
      documentCount: collection.documentCount ?? null,
      collection,
    }));
  }

  return [];
}

async function describeObject(
  input: AiDescribeObjectInput,
  context: AiToolExecutionContext,
): Promise<AiObjectDescription> {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "metadata.describeObject",
    );
  if (capabilities.supportsTableBrowsing) {
    const metadata = await loadTableMetadata({
      connectionId,
      driver,
      schema: namespace,
      table: input.name,
      includeIndexes: capabilities.supportsTableIndexes,
      includeConstraints: capabilities.supportsTableConstraints,
    });

    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: "relation",
      columns: metadata.columns,
      indexes: metadata.indexes,
      constraints: metadata.constraints,
      previewQuery: previewTableQuery(driver, namespace, input.name, 100),
    };
  }

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    const collections = await schemaService.getCollections(
      connectionId,
      namespace,
    );
    const collection = collections.find(
      (candidate) => candidate.name === input.name,
    );
    const metadata =
      capabilities.dataModel === "document" ||
      capabilities.dataModel === "search"
        ? await loadTableMetadata({
            connectionId,
            driver,
            schema: namespace,
            table: input.name,
            includeIndexes: capabilities.dataModel === "document",
            includeConstraints: false,
          })
        : null;
    const previewCollection = collection ?? {
      name: input.name,
      namespace,
      type: null,
      documentCount: null,
    };
    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: collectionKind(capabilities.dataModel),
      collection: collection ?? null,
      columns: metadata?.columns || [],
      indexes: metadata?.indexes || [],
      previewQuery: collectionPreviewQueryTemplateForCapabilities(
        capabilities,
        namespace,
        previewCollection,
      ),
      deleteQuery: collectionDeleteQueryTemplateForCapabilities(
        capabilities,
        namespace,
        previewCollection,
      ),
    };
  }

  return {
    connectionId,
    namespace,
    name: input.name,
    driver,
    kind: "object",
  };
}

function collectionKind(
  dataModel: DatabaseDataModel,
): AiObjectKind {
  if (dataModel === "keyValue") return "key";
  if (dataModel === "search") return "index";
  if (dataModel === "document") return "collection";
  return "object";
}

async function resolveMetadataTarget(
  requestedConnectionId: string | null | undefined,
  requestedNamespace: string | null | undefined,
  context: AiToolExecutionContext,
  toolName: string,
) {
  const connectionId = requestedConnectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error(`No active connection is available for ${toolName}`);
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  if (connection && isManagedConnection(connection)) {
    throw new Error(
      "Managed AI access requires an organization ai.use grant and an enterprise Gateway session.",
    );
  }
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }

  const namespace =
    requestedNamespace ||
    context.activeNamespace ||
    useSchemaStore.getState().currentSchema ||
    "";
  const capabilities = await databaseService.getDatabaseCapabilities(
    driver,
    connection?.driverPackageVersion,
  );
  return { connectionId, namespace, driver, capabilities };
}

function resolveQueryExecutionTarget(
  requestedConnectionId: string | null | undefined,
  requestedNamespace: string | null | undefined,
  context: AiToolExecutionContext,
  toolName: string,
) {
  const connectionId = requestedConnectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error(`No active connection is available for ${toolName}`);
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? "postgres";
  const namespace =
    requestedNamespace ||
    inferActiveQueryNamespace(connectionId, driver, context) ||
    context.activeNamespace ||
    undefined;

  return { connectionId, namespace, driver };
}

function requireLocalAiConnection(connectionId: string) {
  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  if (connection && isManagedConnection(connection)) {
    throw new Error(
      "Managed AI access is unavailable without an organization ai.use grant.",
    );
  }
}

function inferActiveQueryNamespace(
  connectionId: string,
  driver: DatabaseDriver,
  context: AiToolExecutionContext,
) {
  const schemaState = useSchemaStore.getState();
  if (
    context.activeTab &&
    (!context.activeTab.connectionId ||
      context.activeTab.connectionId === connectionId)
  ) {
    return querySchemaContextForTab(
      {
        targetSchema: context.activeTab.targetSchema ?? undefined,
        schemaName: context.activeTab.schemaName ?? undefined,
        tableName: context.activeTab.tableName ?? undefined,
        objectType: context.activeTab.objectType ?? undefined,
      },
      context.activeNamespace || schemaState.currentSchema,
      driver,
    );
  }

  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );

  if (
    activeTab &&
    (!activeTab.connectionId || activeTab.connectionId === connectionId)
  ) {
    return querySchemaContextForTab(
      activeTab,
      schemaState.currentSchema,
      driver,
    );
  }

  return schemaState.currentSchema || undefined;
}

async function executeWorkspaceQuery(
  connectionId: string,
  query: string,
  namespace: string | undefined,
  context: AiToolExecutionContext,
  operation: string,
  includeNamespaceArgument = true,
) {
  const queryId = createCancellableAiQueryId(context, operation);
  if (!queryId) {
    return includeNamespaceArgument
      ? queryService.executeQuery(connectionId, query, namespace)
      : queryService.executeQuery(connectionId, query);
  }

  const abortSignal = context.abortSignal;
  if (abortSignal?.aborted) {
    throw new Error("AI tool execution aborted");
  }

  let isSettled = false;
  const abortHandler = () => {
    if (isSettled) return;
    void queryService.cancelQuery(queryId).catch(() => undefined);
  };
  abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const queryNamespace = includeNamespaceArgument ? namespace : undefined;
    return await queryService.executeQuery(
      connectionId,
      query,
      queryNamespace,
      undefined,
      queryId,
    );
  } finally {
    isSettled = true;
    abortSignal?.removeEventListener("abort", abortHandler);
  }
}

async function executeReadOnlyWorkspaceQuery(
  connectionId: string,
  query: string,
  namespace: string | undefined,
  driver: DatabaseDriver,
  context: AiToolExecutionContext,
) {
  const normalizedDriver =
    normalizeDatabaseDriverName(String(driver)) ||
    String(driver).trim().toLowerCase();
  if (normalizedDriver !== "postgres" && normalizedDriver !== "mysql") {
    return executeWorkspaceQuery(
      connectionId,
      query,
      namespace,
      context,
      "query.runReadOnly",
    );
  }

  const queryId = createCancellableAiQueryId(context, "query.runReadOnly");
  if (context.abortSignal?.aborted) {
    throw new Error("AI tool execution aborted");
  }

  let isSettled = false;
  const abortHandler = () => {
    if (isSettled || !queryId) return;
    void queryService.cancelQuery(queryId).catch(() => undefined);
  };
  context.abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    return await queryService.executeReadOnlyQuery(
      connectionId,
      query,
      namespace,
      queryId,
    );
  } finally {
    isSettled = true;
    context.abortSignal?.removeEventListener("abort", abortHandler);
  }
}

async function executeWorkspaceExplainPlan(
  input: {
    connectionId?: string | null;
    namespace?: string | null;
    query: string;
  },
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, driver } = resolveQueryExecutionTarget(
    input.connectionId,
    input.namespace,
    context,
    "query.explain",
  );
  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const capabilities = await databaseService.getDatabaseCapabilities(
    driver,
    connection?.driverPackageVersion,
  );
  if (!capabilities.supportsExplainPlan) {
    throw new Error(
      `${capabilities.displayName} does not support Explain Plan`,
    );
  }

  const queryId = [
    sanitizeQueryIdSegment(context.requestId),
    "query.explain",
    createRequestId(),
  ].join(":");
  if (context.abortSignal?.aborted) {
    throw new Error("AI tool execution aborted");
  }
  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find(
    (tab) => tab.id === tabState.activeTabId,
  );
  const targetTab =
    activeTab &&
    (!activeTab.connectionId || activeTab.connectionId === connectionId)
      ? activeTab
      : null;
  const database = targetTab?.databaseName || undefined;
  let isSettled = false;
  const abortHandler = () => {
    if (isSettled) return;
    void queryService.cancelQuery(queryId).catch(() => undefined);
  };
  context.abortSignal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const plan = await queryService.explainQuery({
      connectionId,
      queryId,
      sql: input.query,
      schema: database ? undefined : namespace,
      database,
      mode: "estimate",
    });
    if (targetTab) {
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === targetTab.id
            ? {
                ...tab,
                explainPlan: plan,
                queryOutputView: "plan",
                error: null,
              }
            : tab,
        ),
      }));
    }
    return plan;
  } finally {
    isSettled = true;
    context.abortSignal?.removeEventListener("abort", abortHandler);
  }
}

function createCancellableAiQueryId(
  context: AiToolExecutionContext,
  operation: string,
) {
  if (!context.abortSignal) return undefined;
  return [
    sanitizeQueryIdSegment(context.requestId),
    sanitizeQueryIdSegment(operation),
    createRequestId(),
  ].join(":");
}

function sanitizeQueryIdSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-") || "ai";
}

function limitQueryResults(results: QueryResult[], limit: number) {
  const rowLimit = Math.max(0, Math.floor(limit));
  return results.map((result) => ({
    ...result,
    rows: result.rows.slice(0, rowLimit),
  }));
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-tool-${Date.now()}`;
}
