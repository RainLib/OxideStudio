import { createCancelQueryAction } from "./query-execution/cancelQuery";
import { createExplainPlanAction } from "./query-execution/explainPlan";
import { createRunQueryAction } from "./query-execution/runQuery";
import type { TabSlice } from "./types";

/** Composes the independent query, plan, and cancellation execution lifecycles. */
export const createQueryExecutionSlice: TabSlice<
  "runTabQuery" | "runExplainPlan" | "cancelTabQuery"
> = (set, get) => ({
  ...createRunQueryAction(set, get),
  ...createExplainPlanAction(set, get),
  ...createCancelQueryAction(set, get),
});
