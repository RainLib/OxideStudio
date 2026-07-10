import type { DatabaseDriver } from "@/services/tauri/types";
import {
  configuredLspLanguageId,
  lspLanguageId,
  queryEditorLanguageId,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";

export type LspActivationPolicy = "auto" | "off";

export type BuiltInLspProfile = {
  id: string;
  driver: DatabaseDriver;
  displayName: string;
  languageId: string;
  documentLanguageId: string;
  activationPolicy: LspActivationPolicy;
  binaryKind: "bundled";
  metadataLimits: {
    maxTablesPerSchema: number;
    maxCollectionsPerSchema: number;
  };
};

const DEFAULT_METADATA_LIMITS = {
  maxTablesPerSchema: 200,
  maxCollectionsPerSchema: 500,
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
    metadataLimits: DEFAULT_METADATA_LIMITS,
  };
}

export function lspSessionKeyForDriver(options: {
  connectionId: string;
  driver: DatabaseDriver;
}) {
  return `builtin:${String(options.driver)}:${options.connectionId}`;
}
