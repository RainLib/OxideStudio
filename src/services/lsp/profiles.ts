import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types";
import {
  configuredLspLanguageIdForCapabilities,
  defaultDatabaseCapabilities,
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
  queryEditorLanguageIdForCapabilities,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import { DEFAULT_LSP_METADATA_BATCHING } from "./schemaBatching";

export type LspActivationPolicy = "auto" | "off";

export type BuiltInLspProfile = {
  id: string;
  driver: DatabaseDriver;
  displayName: string;
  /** Generic `sql` documents remain neutral while the server uses this parser. */
  serverDialect: string;
  languageId: string;
  documentLanguageId: string;
  activationPolicy: LspActivationPolicy;
  binaryKind: "bundled";
  metadataBatching: {
    batchSize: number;
    concurrency: number;
  };
};

export function builtInLspProfileForDriver(
  driver: DatabaseDriver,
  capabilities?: DatabaseCapabilities,
): BuiltInLspProfile | null {
  const effectiveCapabilities =
    capabilities || defaultDatabaseCapabilities(driver);
  if (!supportsLspCapabilities(effectiveCapabilities)) return null;

  const languageId = lspLanguageIdForCapabilities(effectiveCapabilities);
  const serverDialect = lspServerDialectForCapabilities(effectiveCapabilities);
  return {
    id: `builtin:${String(driver)}:${configuredLspLanguageIdForCapabilities(effectiveCapabilities)}:${serverDialect}`,
    driver,
    displayName: `${String(driver)} intelligence`,
    serverDialect,
    languageId,
    documentLanguageId: queryEditorLanguageIdForCapabilities(
      effectiveCapabilities,
    ),
    activationPolicy: "auto",
    binaryKind: "bundled",
    metadataBatching: DEFAULT_LSP_METADATA_BATCHING,
  };
}

export function lspSessionKeyForDriver(options: {
  connectionId: string;
  driver: DatabaseDriver;
}) {
  return `builtin:${String(options.driver)}:${options.connectionId}`;
}
