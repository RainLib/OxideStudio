import {
  databaseService,
  queryService,
  schemaService,
  tableService,
} from "@/services/tauri";
import {
  extractSqlDocumentTabId,
  getLspDocumentUri,
  lspClient,
} from "@/services/lsp";
import type { Diagnostic } from "@/services/lsp/types";
import type { DatabaseDriver, QueryResult } from "@/services/tauri/types";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import {
  querySchemaContextForTab,
  useTabStore,
  type EditorSelectionState,
} from "@/store/useTabStore";
import {
  lspLanguageId,
  previewTableQuery,
  supportsLspLanguageId,
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

export type WorkspaceAiToolRegistryOptions = {
  families?: AiToolFamily[];
};

export function createWorkspaceAiToolRegistry(
  options: WorkspaceAiToolRegistryOptions = {}
) {
  return registerCoreAiTools(
    createAiToolRegistry(),
    createWorkspaceAiToolAdapters(),
    options.families
  );
}

export function createWorkspaceAiToolContext(
  requestId = createRequestId()
): AiToolExecutionContext {
  const connectionState = useConnectionStore.getState();
  const activeConnection = connectionState.connections.find(
    (connection) => connection.id === connectionState.activeConnectionId
  );

  return {
    requestId,
    activeConnectionId: connectionState.activeConnectionId,
    activeDriver: activeConnection?.driver ?? null,
  };
}

export function createWorkspaceAiToolAdapters(): AiToolAdapters {
  return {
    listConnections: () =>
      useConnectionStore.getState().connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        driver: connection.driver,
      })),

    getConnectionCapabilities: (driver) =>
      databaseService.getDatabaseCapabilities(driver),

    getActiveTab: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
      if (!activeTab) return null;
      return {
        id: activeTab.id,
        type: activeTab.type,
        title: activeTab.title,
        sql: activeTab.sql,
        connectionId: activeTab.connectionId ?? null,
        selection: workspaceSelectionFromTab(activeTab),
      } satisfies AiWorkspaceTabSummary;
    },

    getWorkspaceSelection: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
      return activeTab ? workspaceSelectionFromTab(activeTab) : null;
    },

    listCollections: async (input, context) => {
      const connectionId = input.connectionId || context.activeConnectionId;
      if (!connectionId) {
        throw new Error("No active connection is available for metadata.listCollections");
      }
      const namespace =
        input.namespace || useSchemaStore.getState().currentSchema || "";
      return schemaService.getCollections(connectionId, namespace);
    },

    listObjects: async (input, context) => listObjects(input, context),

    describeObject: async (input, context) => describeObject(input, context),

    runReadOnlyQuery: async (input, context) => {
      const { connectionId, namespace } = resolveQueryExecutionTarget(
        input.connectionId,
        input.namespace,
        context,
        "query.runReadOnly"
      );

      const results = await queryService.executeQuery(
        connectionId,
        input.query,
        namespace
      );
      return limitQueryResults(results, input.limit ?? 200);
    },

    runMutationQuery: async (input, context) => {
      const { connectionId, namespace } = resolveQueryExecutionTarget(
        input.connectionId,
        input.namespace,
        context,
        "mutation query"
      );

      return queryService.executeQuery(connectionId, input.query, namespace);
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

function workspaceSelectionFromTab(tab: {
  id: string;
  title: string;
  connectionId?: string | null;
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
  };
}

async function mutateTableRows(
  input: AiTableMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "table.mutateRows"
    );
  if (!capabilities.supportsTableBrowsing) {
    throw new Error(`${capabilities.displayName} does not support table row mutation`);
  }

  return tableService.mutateTableRows(
    connectionId,
    driver,
    namespace,
    input.table,
    input.inserts ?? [],
    input.updates ?? [],
    input.deletes ?? []
  );
}

async function mutateDocuments(
  input: AiDocumentMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "document.mutate"
  );
  if (capabilities.dataModel !== "document") {
    throw new Error(`${capabilities.displayName} does not support document mutation`);
  }

  return queryService.executeQuery(
    connectionId,
    JSON.stringify(buildMongoMutationCommand(input, namespace))
  );
}

async function mutateKeyValues(
  input: AiKeyValueMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "key.mutate"
  );
  if (capabilities.dataModel !== "keyValue") {
    throw new Error(`${capabilities.displayName} does not support key-value mutation`);
  }

  return queryService.executeQuery(connectionId, buildRedisMutationCommand(input));
}

async function mutateSearchDocuments(
  input: AiSearchDocumentMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "search.mutate"
  );
  if (capabilities.dataModel !== "search") {
    throw new Error(`${capabilities.displayName} does not support search document mutation`);
  }

  return queryService.executeQuery(
    connectionId,
    buildElasticsearchMutationRequest(input)
  );
}

async function getLspCompletions(
  input: AiLspCompletionInput,
  context: AiToolExecutionContext
) {
  const connectionId = input.connectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error("No active connection is available for lsp.getCompletions");
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }
  if (!supportsLspLanguageId(driver)) {
    throw new Error(`${driver} does not support LSP completions`);
  }

  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);
  const languageId = input.languageId || lspLanguageId(driver);
  const uri =
    input.uri ||
    (activeTab
      ? getLspDocumentUri(activeTab.id, driver, languageId)
      : getLspDocumentUri(context.requestId, driver, languageId));
  const text = input.text ?? activeTab?.sql ?? "";

  await lspClient.didOpen(uri, text, Date.now(), languageId);
  return lspClient.getCompletions(uri, input.line, input.character);
}

async function explainLspDiagnostics(
  input: AiLspDiagnosticsInput,
  _context: AiToolExecutionContext
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

  const selection = input.onlySelection ? tab.editorSelection ?? null : null;
  const diagnostics = (tab.lspDiagnostics ?? [])
    .filter((diagnostic) =>
      input.severity
        ? diagnosticSeverityLabel(diagnostic.severity) === input.severity
        : true
    )
    .filter((diagnostic) =>
      selection ? diagnosticOverlapsSelection(diagnostic, selection) : true
    );
  const lines = tab.sql.split(/\r?\n/);
  const explained = diagnostics.map((diagnostic) =>
    explainDiagnostic(diagnostic, lines)
  );

  return {
    tabId: tab.id,
    tabTitle: tab.title,
    uri: input.uri ?? null,
    onlySelection: Boolean(selection),
    summary: diagnosticsSummary(
      explained,
      Boolean(selection),
      input.severity ?? null
    ),
    diagnostics: explained,
  };
}

function explainDiagnostic(
  diagnostic: Diagnostic,
  lines: string[]
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
  severity: number | undefined
): AiExplainedDiagnostic["severityLabel"] {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  if (severity === 3) return "information";
  if (severity === 4) return "hint";
  return "unknown";
}

function diagnosticExplanation(
  message: string,
  severity: ReturnType<typeof diagnosticSeverityLabel>
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
  severity: string | null
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
    {}
  );
  const countText = Object.entries(counts)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
  return `Found ${diagnostics.length} LSP diagnostic(s) for the ${scope}: ${countText}.`;
}

function diagnosticOverlapsSelection(
  diagnostic: Diagnostic,
  selection: EditorSelectionState
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
  right: { line: number; column: number }
) {
  if (left.line !== right.line) return left.line - right.line;
  return left.column - right.column;
}

async function mutateNamespace(
  input: AiNamespaceMutationInput,
  context: AiToolExecutionContext
) {
  const { connectionId, driver, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "database.mutateNamespace"
  );

  if (input.operation === "create") {
    if (!capabilities.supportsCreateDatabase) {
      throw new Error(
        `${capabilities.displayName} does not support namespace creation`
      );
    }
    return databaseService.createDatabase(
      connectionId,
      driver,
      input.namespace,
      input.charset ?? undefined,
      input.collation ?? undefined
    );
  }

  if (!capabilities.supportsCreateDatabase) {
    throw new Error(
      `${capabilities.displayName} does not support namespace deletion`
    );
  }
  return databaseService.dropDatabase(
    connectionId,
    driver,
    input.namespace,
    input.cascade ?? false
  );
}

async function listObjects(
  input: AiListObjectsInput,
  context: AiToolExecutionContext
): Promise<AiObjectSummary[]> {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "metadata.listObjects"
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
    const collections = await schemaService.getCollections(connectionId, namespace);
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
  context: AiToolExecutionContext
): Promise<AiObjectDescription> {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "metadata.describeObject"
    );
  if (capabilities.supportsTableBrowsing) {
    const [columns, indexes, constraints] = await Promise.all([
      schemaService.getColumns(connectionId, namespace, input.name),
      capabilities.supportsTableIndexes
        ? schemaService.getIndexes(connectionId, namespace, input.name)
        : Promise.resolve([]),
      capabilities.supportsTableConstraints
        ? schemaService.getConstraints(connectionId, namespace, input.name)
        : Promise.resolve([]),
    ]);

    return {
      connectionId,
      namespace,
      name: input.name,
      driver,
      kind: "relation",
      columns,
      indexes,
      constraints,
      previewQuery: previewTableQuery(driver, namespace, input.name, 100),
    };
  }

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    const collections = await schemaService.getCollections(connectionId, namespace);
    const collection = collections.find((candidate) => candidate.name === input.name);
    const [columns, indexes] = await Promise.all([
      capabilities.dataModel === "document" || capabilities.dataModel === "search"
        ? schemaService.getColumns(connectionId, namespace, input.name).catch(() => [])
        : Promise.resolve([]),
      capabilities.dataModel === "document"
        ? schemaService.getIndexes(connectionId, namespace, input.name).catch(() => [])
        : Promise.resolve([]),
    ]);
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
      columns,
      indexes,
      previewQuery: collectionPreviewQueryTemplateForCapabilities(
        capabilities,
        namespace,
        previewCollection
      ),
      deleteQuery: collectionDeleteQueryTemplateForCapabilities(
        capabilities,
        namespace,
        previewCollection
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
  dataModel: "relational" | "document" | "keyValue" | "search"
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
  toolName: string
) {
  const connectionId = requestedConnectionId || context.activeConnectionId;
  if (!connectionId) {
    throw new Error(`No active connection is available for ${toolName}`);
  }

  const connection = useConnectionStore
    .getState()
    .connections.find((candidate) => candidate.id === connectionId);
  const driver = connection?.driver ?? context.activeDriver ?? null;
  if (!driver) {
    throw new Error(`Connection driver is not available for ${connectionId}`);
  }

  const namespace = requestedNamespace || useSchemaStore.getState().currentSchema || "";
  const capabilities = await databaseService.getDatabaseCapabilities(driver);
  return { connectionId, namespace, driver, capabilities };
}

function resolveQueryExecutionTarget(
  requestedConnectionId: string | null | undefined,
  requestedNamespace: string | null | undefined,
  context: AiToolExecutionContext,
  toolName: string
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
    inferActiveQueryNamespace(connectionId, driver) ||
    undefined;

  return { connectionId, namespace };
}

function inferActiveQueryNamespace(connectionId: string, driver: DatabaseDriver) {
  const schemaState = useSchemaStore.getState();
  const tabState = useTabStore.getState();
  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId);

  if (
    activeTab &&
    (!activeTab.connectionId || activeTab.connectionId === connectionId)
  ) {
    return querySchemaContextForTab(activeTab, schemaState.currentSchema, driver);
  }

  return schemaState.currentSchema || undefined;
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
