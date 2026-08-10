import type { DatabaseDriver } from "@/services/tauri/types";
import {
  createLspConfigKey,
  type LspConfigKeyInput,
  type LspCompletionPreferences,
  type LspFormattingPreferences,
  type LspFileMappings,
} from "./syncPlan";
import type { LspSchemaDefinition } from "./schemaConfig";

export type LspConfigurationPayload = LspFileMappings & {
  defaultDialect: string;
  completionPreferences: LspCompletionPreferences;
  formattingPreferences: LspFormattingPreferences;
  schemas: LspSchemaDefinition[];
};

export type LspConfigDispatchStatus =
  | "stale"
  | "duplicate"
  | "sent"
  | "sent-stale";

export type LspConfigDispatchResult = {
  status: LspConfigDispatchStatus;
  configKey?: string;
  lastConfigKey: string | null;
};

export async function dispatchLspConfiguration(options: {
  connectionId: string;
  driver: DatabaseDriver;
  lspDialect: string;
  config: LspConfigurationPayload;
  lastConfigKey: string | null;
  syncGeneration: number;
  getCurrentGeneration: () => number;
  isCancelled?: () => boolean;
  updateConfiguration: (config: LspConfigurationPayload) => Promise<void>;
}): Promise<LspConfigDispatchResult> {
  const isStale = () =>
    options.isCancelled?.() === true ||
    options.syncGeneration !== options.getCurrentGeneration();

  if (isStale()) {
    return {
      status: "stale",
      lastConfigKey: options.lastConfigKey,
    };
  }

  const keyInput: LspConfigKeyInput = {
    connectionId: options.connectionId,
    driver: options.driver,
    lspDialect: options.lspDialect,
    completionPreferences: options.config.completionPreferences,
    formattingPreferences: options.config.formattingPreferences,
    fileSchemas: options.config.fileSchemas,
    fileDialects: options.config.fileDialects,
    schemaDefinitions: options.config.schemas,
  };
  const configKey = createLspConfigKey(keyInput);

  if (options.lastConfigKey === configKey) {
    return {
      status: "duplicate",
      configKey,
      lastConfigKey: options.lastConfigKey,
    };
  }

  await options.updateConfiguration(options.config);

  if (isStale()) {
    return {
      status: "sent-stale",
      configKey,
      lastConfigKey: options.lastConfigKey,
    };
  }

  return {
    status: "sent",
    configKey,
    lastConfigKey: configKey,
  };
}
