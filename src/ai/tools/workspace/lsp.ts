import type {
  AiLspCompletionInput,
  AiLspDiagnosticsExplanation,
  AiLspDiagnosticsInput,
  AiToolAdapters,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import {
  diagnosticOverlapsSelection,
  diagnosticSeverityLabel,
  diagnosticsSummary,
  explainDiagnostic,
} from "@/ai/tools/workspace/lspDiagnostics";
import {
  lspLanguageIdForCapabilities,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import {
  ensureLspSession,
  extractSqlDocumentTabId,
  getLspDocumentUri,
} from "@/services/lsp";
import { databaseService } from "@/services/tauri";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";

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

export function createLspAdapters(): Pick<
  AiToolAdapters,
  "getLspCompletions" | "explainLspDiagnostics"
> {
  return {
    getLspCompletions: async (input, context) =>
      getLspCompletions(input, context),

    explainLspDiagnostics: async (input, context) =>
      explainLspDiagnostics(input, context),
  };
}
