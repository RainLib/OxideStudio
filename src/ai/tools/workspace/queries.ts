import type { AiToolAdapters } from "@/ai/tools/types";
import {
  executeReadOnlyWorkspaceQuery,
  executeWorkspaceExplainPlan,
  executeWorkspaceQuery,
  limitQueryResults,
} from "@/ai/tools/workspace/queryExecution";
import { resolveQueryExecutionTarget } from "@/ai/tools/workspace/targets";

export function createQueryAdapters(): Pick<
  AiToolAdapters,
  "runReadOnlyQuery" | "explainQuery" | "runMutationQuery"
> {
  return {
    runReadOnlyQuery: async (input, context) => {
      const { connectionId, namespace, driver } = resolveQueryExecutionTarget(
        input.connectionId,
        input.namespace,
        context,
        "query.runReadOnly",
      );

      const results = await executeReadOnlyWorkspaceQuery(
        connectionId,
        input.query,
        namespace,
        driver,
        context,
      );
      return limitQueryResults(results, input.limit ?? 200);
    },

    explainQuery: async (input, context) =>
      executeWorkspaceExplainPlan(input, context),

    runMutationQuery: async (input, context) => {
      const { connectionId, namespace } = resolveQueryExecutionTarget(
        input.connectionId,
        input.namespace,
        context,
        "mutation query",
      );

      return executeWorkspaceQuery(
        connectionId,
        input.query,
        namespace,
        context,
        "query.runMutation",
      );
    },
  };
}
