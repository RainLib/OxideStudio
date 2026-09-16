import { ElasticsearchResponseView } from "@/components/workspace/ElasticsearchResponseView";
import type {
  AppSettings,
  WorkbenchToolWindowId,
} from "@/features/settings/model/settingsTypes";
import { QueryResultsFallback } from "@/features/workbench/ui/WorkbenchFallbacks";
import {
  DataGrid,
  ExplainPlanView,
} from "@/features/workbench/ui/WorkbenchLazySurfaces";
import type {
  QueryResultRun,
  TabData,
} from "@/features/workspace-tabs/model/types";
import type { QueryErrorPresentation } from "@/lib/queryErrorPresentation";
import { cn } from "@/lib/utils";
import type { QueryResult } from "@/services/tauri/types/query";
import { ChevronDown, LineChart, Pin, X } from "lucide-react";
import { Suspense } from "react";

interface WorkbenchQueryResultsContext {
  layout: AppSettings["workbench"]["layout"];
  activePanelClass: string;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
  isPlanView: boolean;
  queryResults: QueryResult[];
  activeTab: Pick<
    TabData,
    "id" | "activeResultRunId" | "error" | "explainPlan" | "isExecuting"
  > | null;
  setQueryOutputView: (id: string, view: "results" | "plan") => void;
  queryResultRuns: QueryResultRun[];
  setActiveResultRun: (id: string, runId: string) => void;
  pinnedQueryResultRunCount: number;
  toggleResultRunPin: (id: string, runId: string) => void;
  closeResultRun: (id: string, runId: string) => void;
  activeResultIndex: number;
  setActiveResultIndex: (id: string, index: number) => void;
  closeResultAt: (id: string, index: number) => void;
  currentResult: QueryResult | undefined;
  queryErrorPresentation: QueryErrorPresentation | null;
  setToolWindowVisible: (id: WorkbenchToolWindowId, visible: boolean) => void;
}

export function WorkbenchQueryResults({
  layout,
  activePanelClass,
  setActiveToolWindow,
  isPlanView,
  queryResults,
  activeTab,
  setQueryOutputView,
  queryResultRuns,
  setActiveResultRun,
  pinnedQueryResultRunCount,
  toggleResultRunPin,
  closeResultRun,
  activeResultIndex,
  setActiveResultIndex,
  closeResultAt,
  currentResult,
  queryErrorPresentation,
  setToolWindowVisible,
}: WorkbenchQueryResultsContext) {
  return (
    <div
      className={cn(
        "min-h-[140px] shrink-0 overflow-hidden rounded-b-[6px] border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-grid))]",
        layout.activeToolWindow === "results" && activePanelClass,
      )}
      style={{ height: `${layout.bottomHeight}px` }}
      onFocus={() => setActiveToolWindow("results")}
      data-workbench-results
      tabIndex={-1}
    >
      <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2 text-[11px] text-[hsl(var(--wb-text-muted))]">
        <div className="flex min-w-0 items-center gap-1.5">
          {(!isPlanView || queryResults.length > 0) && (
            <button
              type="button"
              className={cn(
                "mr-1 flex h-5 items-center rounded-[3px] px-2 font-medium",
                !isPlanView
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "hover:bg-[hsl(var(--wb-hover))]",
              )}
              onClick={() =>
                activeTab && setQueryOutputView(activeTab.id, "results")
              }
            >
              Results
            </button>
          )}
          {(activeTab?.explainPlan || isPlanView) && (
            <button
              type="button"
              className={cn(
                "mr-1 flex h-5 items-center gap-1.5 rounded-[3px] px-2 font-medium",
                isPlanView
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "hover:bg-[hsl(var(--wb-hover))]",
              )}
              onClick={() =>
                activeTab && setQueryOutputView(activeTab.id, "plan")
              }
            >
              <LineChart size={11} />
              Explain Plan
            </button>
          )}
          {!isPlanView && queryResultRuns.length > 1 && (
            <div className="flex min-w-0 items-center gap-0.5 border-l border-[hsl(var(--wb-border-subtle))] pl-1">
              {queryResultRuns.map((run, index) => (
                <div
                  key={run.id}
                  className={cn(
                    "group/run flex h-5 max-w-[122px] items-center rounded-[3px]",
                    run.id === activeTab?.activeResultRunId
                      ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                      : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 truncate px-2 text-[10px]"
                    onClick={() =>
                      activeTab && setActiveResultRun(activeTab.id, run.id)
                    }
                    title={`Execution ${index + 1}: ${run.results
                      .reduce((count, result) => count + result.rows.length, 0)
                      .toLocaleString()} rows`}
                  >
                    {run.pinned && (
                      <Pin
                        size={9}
                        className="mr-1 inline-block -translate-y-px text-[hsl(var(--wb-accent))]"
                      />
                    )}
                    Run {index + 1}
                  </button>
                  <button
                    type="button"
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] group-hover/run:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
                    title={
                      run.pinned
                        ? "Unpin result run"
                        : pinnedQueryResultRunCount >= 3
                          ? "Only three result runs can be pinned"
                          : "Pin result run"
                    }
                    disabled={!run.pinned && pinnedQueryResultRunCount >= 3}
                    onClick={() =>
                      activeTab && toggleResultRunPin(activeTab.id, run.id)
                    }
                  >
                    <Pin size={9} />
                  </button>
                  <button
                    type="button"
                    className="mr-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] group-hover/run:opacity-100 focus-visible:opacity-100"
                    title="Close result run"
                    onClick={() =>
                      activeTab && closeResultRun(activeTab.id, run.id)
                    }
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!isPlanView && queryResults.length > 1 ? (
            <div className="flex min-w-0 items-center gap-0.5">
              {queryResults.map((result, index) => (
                <button
                  key={`${activeTab?.id}:result:${index}`}
                  type="button"
                  className={cn(
                    "group/result flex h-5 max-w-[150px] items-center gap-1 rounded-[3px] pl-2 pr-1 text-[10px] hover:bg-[hsl(var(--wb-hover))]",
                    index === activeResultIndex
                      ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                      : "text-[hsl(var(--wb-text-muted))]",
                  )}
                  onClick={() =>
                    activeTab && setActiveResultIndex(activeTab.id, index)
                  }
                  title={`${result.rows.length.toLocaleString()} rows`}
                >
                  <span className="truncate">
                    {result.responseMeta?.requestPath || `Result ${index + 1}`}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] hover:opacity-100 group-hover/result:opacity-100 focus-visible:opacity-100"
                    title="Close result"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (activeTab) {
                        closeResultAt(activeTab.id, index);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (activeTab) {
                          closeResultAt(activeTab.id, index);
                        }
                      }
                    }}
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
            </div>
          ) : !isPlanView && queryResults.length === 1 ? (
            <button
              type="button"
              className="group/result flex h-5 items-center gap-1 rounded-[3px] bg-[hsl(var(--wb-active-strong))] pl-2 pr-1 text-[10px] text-[hsl(var(--wb-text))]"
              onClick={() => activeTab && setActiveResultIndex(activeTab.id, 0)}
            >
              <span>Result</span>
              {currentResult && (
                <span
                  role="button"
                  tabIndex={0}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-[2px] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] hover:opacity-100 group-hover/result:opacity-100 focus-visible:opacity-100"
                  title="Close result"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (activeTab) {
                      closeResultAt(activeTab.id, 0);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (activeTab) {
                        closeResultAt(activeTab.id, 0);
                      }
                    }
                  }}
                >
                  <X size={10} />
                </span>
              )}
            </button>
          ) : null}
          {!isPlanView && currentResult && (
            <>
              <span className="whitespace-nowrap text-[10px]">
                {currentResult.rows.length.toLocaleString()} rows
              </span>
              {currentResult.responseMeta && (
                <span className="whitespace-nowrap text-[10px] text-emerald-400">
                  HTTP {currentResult.responseMeta.status}
                  {" · "}
                  {currentResult.responseMeta.durationMs.toLocaleString()} ms
                </span>
              )}
            </>
          )}
          {activeTab?.isExecuting && (
            <span className="whitespace-nowrap">Running...</span>
          )}
          {activeTab?.error && (
            <span className="truncate text-[hsl(var(--destructive))]">
              {queryErrorPresentation?.title || "Query failed"}
            </span>
          )}
        </div>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={() => setToolWindowVisible("results", false)}
          title="Hide Results"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="h-[calc(100%-2rem)] min-h-0">
        <Suspense fallback={<QueryResultsFallback />}>
          {isPlanView ? (
            activeTab?.explainPlan ? (
              <ExplainPlanView
                tabId={activeTab.id}
                plan={activeTab.explainPlan}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-[hsl(var(--wb-text-muted))]">
                {activeTab?.isExecuting
                  ? "Generating Explain Plan…"
                  : activeTab?.error || "No Explain Plan is available."}
              </div>
            )
          ) : currentResult ? (
            <ElasticsearchResponseView result={currentResult}>
              <DataGrid readOnly />
            </ElasticsearchResponseView>
          ) : (
            <DataGrid readOnly />
          )}
        </Suspense>
      </div>
    </div>
  );
}
