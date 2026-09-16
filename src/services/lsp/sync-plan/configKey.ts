import { lspSchemaSignature } from "../schemaConfig";
import type { LspConfigKeyInput } from "./types";

export function createLspConfigKey(input: LspConfigKeyInput) {
  return JSON.stringify({
    connectionId: input.connectionId,
    driver: input.driver,
    lspDialect: input.lspDialect,
    completionPreferences: input.completionPreferences || {
      keywordCase: "upper",
      functionCase: "preserve",
      tableAlias: "none",
    },
    formattingPreferences: input.formattingPreferences || {
      keywordCase: "upper",
      functionCase: "preserve",
      logicalOperatorNewline: "before",
      fromClauseLayout: "newLine",
    },
    fileSchemas: input.fileSchemas,
    fileDialects: input.fileDialects,
    schemaSignature: lspSchemaSignature(input.schemaDefinitions),
  });
}
