import { querySchemaContextForTab } from "@/features/workspace-tabs/model/tabIdentity";
import { DEFAULT_DATABASE_DRIVER } from "@/lib/databaseDialect";
import { queryService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTaskStore } from "@/store/useTaskStore";
import { v4 as uuidv4 } from "uuid";
import type { TabSlice } from "../types";

/** Owns explain/analyze plan execution and its tab/task lifecycle. */
export const createExplainPlanAction: TabSlice<"runExplainPlan"> = (set, get) => ({
  runExplainPlan: async (id, connectionId, sql, mode = "estimate") => {
    const tab = get().tabs.find((candidate) => candidate.id === id);
    if (!tab || !sql.trim()) return;

    const { currentSchema } = useSchemaStore.getState();
    const connection = useConnectionStore
      .getState()
      .connections.find((item) => item.id === connectionId);
    const schemaContext = querySchemaContextForTab(
      tab,
      currentSchema,
      connection?.driver || DEFAULT_DATABASE_DRIVER,
    );
    const queryId = `${id}:plan:${uuidv4()}`;
    const taskStore = useTaskStore.getState();
    const taskId = taskStore.startTask({
      kind: "query",
      title: `${mode === "analyze" ? "Analyze" : "Explain"} ${tab.title}`,
      detail:
        mode === "analyze"
          ? "Executing a read-only analyzed plan"
          : "Generating an estimated plan",
    });

    set((state) => ({
      tabs: state.tabs.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              isExecuting: true,
              runningQueryId: queryId,
              error: null,
              explainPlan: null,
              queryOutputView: "plan",
            }
          : candidate,
      ),
    }));

    try {
      const plan = await queryService.explainQuery({
        connectionId,
        sql,
        schema: tab.databaseName ? undefined : schemaContext || undefined,
        database: tab.databaseName || undefined,
        queryId,
        mode,
      });
      taskStore.finishTask(
        taskId,
        `${plan.mode === "analyze" ? "Analyzed" : "Estimated"} in ${plan.generatedInMs.toFixed(1)} ms`,
      );
      set((state) => ({
        tabs: state.tabs.map((candidate) =>
          candidate.id === id && candidate.runningQueryId === queryId
            ? {
                ...candidate,
                isExecuting: false,
                runningQueryId: null,
                explainPlan: plan,
                queryOutputView: "plan",
              }
            : candidate,
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      taskStore.failTask(taskId, message);
      set((state) => ({
        tabs: state.tabs.map((candidate) =>
          candidate.id === id && candidate.runningQueryId === queryId
            ? {
                ...candidate,
                isExecuting: false,
                runningQueryId: null,
                error: message,
                queryOutputView: "plan",
              }
            : candidate,
        ),
      }));
    }
  },
});
