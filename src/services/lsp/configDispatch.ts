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
  oxideAnalysisToken?:string;
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
  analysisToken?:string|null;
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
  lastAnalysisToken?:string|null;
  syncGeneration: number;
  getCurrentGeneration: () => number;
  isCancelled?: () => boolean;
  updateConfiguration: (config: LspConfigurationPayload) => Promise<void>;
  confirmConfiguration: (token: string) => Promise<boolean>;
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

  if (options.lastConfigKey === configKey && options.lastAnalysisToken &&
    /^[A-Za-z0-9_-]{1,128}$/.test(options.lastAnalysisToken)) {
    const applied = await options.confirmConfiguration(options.lastAnalysisToken);
    if (isStale()) return { status: "stale", lastConfigKey: options.lastConfigKey };
    if (applied) return {
      analysisToken: options.lastAnalysisToken,
      status: "duplicate", configKey, lastConfigKey: options.lastConfigKey,
    };
  }

  const analysisToken=crypto.randomUUID();
  await options.updateConfiguration({...options.config,oxideAnalysisToken:analysisToken});

  if (isStale()) {
    return {
      status: "sent-stale",
      configKey,
      lastConfigKey: options.lastConfigKey,
    };
  }

  const applied = await options.confirmConfiguration(analysisToken);
  if (isStale()) return {
    status: "sent-stale", configKey, lastConfigKey: options.lastConfigKey,
  };
  if (!applied) throw new Error("LSP configuration has not been confirmed by the server");

  return {
    analysisToken,
    status: "sent",
    configKey,
    lastConfigKey: configKey,
  };
}
