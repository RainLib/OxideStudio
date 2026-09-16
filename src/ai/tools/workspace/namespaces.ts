import type {
  AiNamespaceMutationInput,
  AiToolAdapters,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import { resolveMetadataTarget } from "@/ai/tools/workspace/targets";
import { databaseService } from "@/services/tauri";

async function mutateNamespace(
  input: AiNamespaceMutationInput,
  context: AiToolExecutionContext,
) {
  const { connectionId, driver, capabilities } = await resolveMetadataTarget(
    input.connectionId,
    null,
    context,
    "database.mutateNamespace",
  );

  if (input.operation === "create") {
    if (!capabilities.supportsCreateDatabase) {
      throw new Error(
        `${capabilities.displayName} does not support namespace creation`,
      );
    }
    return databaseService.createDatabase(
      connectionId,
      driver,
      input.namespace,
      input.charset ?? undefined,
      input.collation ?? undefined,
    );
  }

  if (!capabilities.supportsCreateDatabase) {
    throw new Error(
      `${capabilities.displayName} does not support namespace deletion`,
    );
  }
  return databaseService.dropDatabase(
    connectionId,
    driver,
    input.namespace,
    input.cascade ?? false,
  );
}

export function createNamespaceAdapters(): Pick<
  AiToolAdapters,
  "mutateNamespace"
> {
  return {
    mutateNamespace: async (input, context) => mutateNamespace(input, context),
  };
}
