import type { DatabaseDriver } from "@/services/tauri/types";
import {
  configuredLspLanguageId,
  lspLanguageId,
  queryEditorLanguageId,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";
import { DEFAULT_LSP_METADATA_BATCHING } from "./schemaBatching";

export type LspActivationPolicy = "auto" | "off";

export type BuiltInLspProfile = {
  id: string;
  driver: DatabaseDriver;
  displayName: string;
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
  driver: DatabaseDriver
): BuiltInLspProfile | null {
  if (!supportsLspLanguageId(driver)) return null;

  const languageId = lspLanguageId(driver);
  return {
    id: `builtin:${String(driver)}:${configuredLspLanguageId(driver)}`,
    driver,
    displayName: `${String(driver)} intelligence`,
    languageId,
    documentLanguageId: queryEditorLanguageId(driver),
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
