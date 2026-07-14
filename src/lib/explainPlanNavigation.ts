export const APP_EVENT_REVEAL_PLAN_NODE = "oxide:reveal-plan-node";

export interface ExplainPlanNodeNavigationDetail {
  tabId: string;
  planId: string;
  nodeId: string;
}

export function requestExplainPlanNodeReveal(
  detail: ExplainPlanNodeNavigationDetail,
) {
  window.dispatchEvent(
    new CustomEvent<ExplainPlanNodeNavigationDetail>(
      APP_EVENT_REVEAL_PLAN_NODE,
      { detail },
    ),
  );
}
