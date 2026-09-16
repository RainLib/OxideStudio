import type { LspClient } from "@/services/lsp/client";
import { type CachedLspMetadata } from "@/services/lsp/metadataCache";
import { type LspTableDefinition } from "@/services/lsp/schemaConfig";

export type CachedLspTableDefinition = CachedLspMetadata<LspTableDefinition>;

export type ProjectDocumentClient = Pick<
  LspClient,
  "getSessionKey" | "didOpen" | "didChange" | "didClose"
>;

export type OpenProjectLspDocument = {
  client: ProjectDocumentClient;
  sessionKey: string;
  content: string;
  version: number;
};
