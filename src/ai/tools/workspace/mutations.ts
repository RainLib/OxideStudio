import {
  buildElasticsearchMutationRequest,
  buildMongoMutationCommand,
  buildRedisMutationCommand,
} from "@/ai/tools/nativeMutationBuilders";
import type {
  AiDocumentMutationInput,
  AiKeyValueMutationInput,
  AiSearchDocumentMutationInput,
  AiTableMutationInput,
  AiToolAdapters,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import { executeWorkspaceQuery } from "@/ai/tools/workspace/queryExecution";
import { resolveMetadataTarget } from "@/ai/tools/workspace/targets";
import { tableService } from "@/services/tauri";

async function mutateTableRows(
  input: AiTableMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, driver, capabilities } =
    await resolveMetadataTarget(
      input.connectionId,
      input.namespace,
      context,
      "table.mutateRows",
    );
  if (!capabilities.supportsTableBrowsing) {
    throw new Error(
      `${capabilities.displayName} does not support table row mutation`,
    );
  }

  return tableService.mutateTableRows(
    connectionId,
    driver,
    namespace,
    input.table,
    input.inserts ?? [],
    input.updates ?? [],
    input.deletes ?? [],
  );
}

async function mutateDocuments(
  input: AiDocumentMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "document.mutate",
  );
  if (capabilities.dataModel !== "document") {
    throw new Error(
      `${capabilities.displayName} does not support document mutation`,
    );
  }

  return executeWorkspaceQuery(
    connectionId,
    JSON.stringify(buildMongoMutationCommand(input, namespace)),
    undefined,
    context,
    "document.mutate",
    false,
  );
}

async function mutateKeyValues(
  input: AiKeyValueMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, namespace, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    input.namespace,
    context,
    "key.mutate",
  );
  if (capabilities.dataModel !== "keyValue") {
    throw new Error(
      `${capabilities.displayName} does not support key-value mutation`,
    );
  }

  return executeWorkspaceQuery(
    connectionId,
    buildRedisMutationCommand(input),
    namespace || undefined,
    context,
    "key.mutate",
  );
}

async function mutateSearchDocuments(
  input: AiSearchDocumentMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "search.mutate",
  );
  if (capabilities.dataModel !== "search") {
    throw new Error(
      `${capabilities.displayName} does not support search document mutation`,
    );
  }

  return executeWorkspaceQuery(
    connectionId,
    buildElasticsearchMutationRequest(input),
    undefined,
    context,
    "search.mutate",
    false,
  );
}

export function createMutationAdapters(): Pick<
  AiToolAdapters,
  | "mutateTableRows"
  | "mutateDocuments"
  | "mutateKeyValues"
  | "mutateSearchDocuments"
> {
  return {
    mutateTableRows: async (input, context) => mutateTableRows(input, context),

    mutateDocuments: async (input, context) => mutateDocuments(input, context),

    mutateKeyValues: async (input, context) => mutateKeyValues(input, context),

    mutateSearchDocuments: async (input, context) =>
      mutateSearchDocuments(input, context),
  };
}
