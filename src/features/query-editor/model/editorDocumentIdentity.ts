import {
  lspLanguageIdForCapabilities,
  queryEditorLanguageIdForCapabilities,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import { ELASTICSEARCH_CONSOLE_LANGUAGE_ID } from "@/lib/elasticsearchConsole";
import { MONGODB_CONSOLE_LANGUAGE_ID } from "@/lib/mongodbCompletion";
import {
  projectFileLanguage,
  projectFileModelUri,
  type ProjectFileLanguage,
} from "@/lib/projectFileLanguage";
import { getLspDocumentUri } from "@/services/lsp";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";

export type EditorDocumentTab = {
  id: string;
  fileRelativePath?: string;
  filePreview?: unknown;
  agentFileDiffPreview?: unknown;
  gitFileDiffPreview?: unknown;
  queryLanguage?: "elasticsearch-dsl" | "elasticsearch-eql";
};

export type EditorDocumentIdentity = {
  isProjectFilePreview: boolean;
  projectFileLanguage: ProjectFileLanguage | null;
  isElasticsearchEql: boolean;
  isElasticsearchConsole: boolean;
  documentLanguageId: string;
  documentUri: string;
  editorLanguageId: string;
  canUseLsp: boolean;
  usesGenericSqlLsp: boolean;
};

/**
 * The identity of a Monaco model is not the same thing as its visual tab.
 * Keep this calculation pure so project files, diff previews and a changing
 * connection capability cannot accidentally reuse one another's LSP document.
 */
export function editorDocumentIdentity(options: {
  tab: EditorDocumentTab | null | undefined;
  driver: DatabaseDriver;
  capabilities: DatabaseCapabilities;
}): EditorDocumentIdentity {
  const { tab, driver, capabilities } = options;
  const isProjectFilePreview = Boolean(tab?.filePreview);
  const activeProjectFileLanguage =
    tab?.fileRelativePath && !isProjectFilePreview
      ? projectFileLanguage(tab.fileRelativePath, driver)
      : null;
  const isElasticsearchEql =
    driver === "elasticsearch" && tab?.queryLanguage === "elasticsearch-eql";
  const documentLanguageId =
    activeProjectFileLanguage?.lspLanguageId ||
    (isElasticsearchEql
      ? "elasticsearch-eql"
      : lspLanguageIdForCapabilities(capabilities));
  const documentUri = tab
    ? activeProjectFileLanguage && !activeProjectFileLanguage.usesDatabaseLsp
      ? projectFileModelUri(tab.id, activeProjectFileLanguage)
      : getLspDocumentUri(tab.id, driver, documentLanguageId)
    : "";
  const editorLanguageId =
    activeProjectFileLanguage?.editorLanguageId ||
    (isElasticsearchEql
      ? "plaintext"
      : driver === "elasticsearch"
        ? ELASTICSEARCH_CONSOLE_LANGUAGE_ID
        : driver === "mongodb"
          ? MONGODB_CONSOLE_LANGUAGE_ID
        : queryEditorLanguageIdForCapabilities(capabilities));
  const canUseLsp = Boolean(
    !isProjectFilePreview &&
      !tab?.agentFileDiffPreview &&
      !tab?.gitFileDiffPreview &&
      !isElasticsearchEql &&
      supportsLspCapabilities(capabilities) &&
      (!activeProjectFileLanguage || activeProjectFileLanguage.usesDatabaseLsp),
  );
  const isElasticsearchConsole =
    driver === "elasticsearch" && tab?.queryLanguage !== "elasticsearch-eql";

  return {
    isProjectFilePreview,
    projectFileLanguage: activeProjectFileLanguage,
    isElasticsearchEql,
    isElasticsearchConsole,
    documentLanguageId,
    documentUri,
    editorLanguageId,
    canUseLsp,
    usesGenericSqlLsp:
      canUseLsp && lspLanguageIdForCapabilities(capabilities) === "sql",
  };
}
