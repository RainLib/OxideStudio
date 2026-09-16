import { Button } from "@/components/ui/button";
import type { GridTabSnapshot } from "@/features/data-grid/model/gridTypes";
import type { TabState } from "@/features/workspace-tabs/model/types";
import type {
  QueryErrorPresentation,
  QueryExecutionErrorDetail,
} from "@/lib/queryErrorPresentation";
import type { AssistantQueryErrorComposeRequest } from "@/store/useAssistantComposerStore";
import { APP_EVENT_OPEN_ASSISTANT } from "@/store/useAssistantComposerStore";

import { CircleAlert, RotateCcw, Sparkles } from "lucide-react";

interface GridQueryErrorProps {
  errorPresentation: QueryErrorPresentation;
  activeTab: GridTabSnapshot | null;
  queueQueryErrorFix: (
    tabId: string,
    detail: QueryExecutionErrorDetail,
  ) => AssistantQueryErrorComposeRequest;
  runTabQuery: TabState["runTabQuery"];
}

export function GridQueryError({
  errorPresentation,
  activeTab,
  queueQueryErrorFix,
  runTabQuery,
}: GridQueryErrorProps) {
  return (
    <div
      role="alert"
      className="flex h-full items-center justify-center overflow-auto px-6 py-8"
    >
      <div className="w-full max-w-[560px] rounded-[6px] border border-[hsl(var(--destructive)/0.28)] bg-[hsl(var(--destructive)/0.06)] px-5 py-4">
        <div className="flex items-start gap-3">
          <CircleAlert
            size={18}
            className="mt-0.5 shrink-0 text-[hsl(var(--destructive))]"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
              {errorPresentation.title}
            </h3>
            <p className="mt-1 text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
              {errorPresentation.description}
            </p>
            {errorPresentation.metadata.length > 0 && (
              <dl className="mt-2 flex flex-wrap gap-1.5">
                {errorPresentation.metadata.map((item) => (
                  <div
                    key={`${item.label}:${item.value}`}
                    className="inline-flex min-w-0 items-center gap-1 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    <dt className="text-[hsl(var(--wb-text-muted))]">
                      {item.label}
                    </dt>
                    <dd className="max-w-[260px] truncate text-[hsl(var(--wb-text))]">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {errorPresentation.suggestion && (
              <p className="mt-2 text-[12px] leading-5 text-[hsl(var(--wb-text))]">
                {errorPresentation.suggestion}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {activeTab?.type === "query" &&
                activeTab.queryError?.database && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 rounded-[4px] px-2.5 text-[11px]"
                    onClick={() => {
                      queueQueryErrorFix(activeTab.id, activeTab.queryError!);
                      window.dispatchEvent(
                        new CustomEvent(APP_EVENT_OPEN_ASSISTANT),
                      );
                    }}
                  >
                    <Sparkles size={12} aria-hidden="true" />
                    Ask AI to fix
                  </Button>
                )}
              {errorPresentation.retryable && activeTab?.connectionId && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 gap-1.5 rounded-[4px] px-2.5 text-[11px]"
                  disabled={activeTab.isExecuting}
                  onClick={() =>
                    void runTabQuery(activeTab.id, activeTab.connectionId!)
                  }
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  Run query again
                </Button>
              )}
            </div>
            {errorPresentation.technicalDetails && (
              <details className="mt-3 text-[11px] text-[hsl(var(--wb-text-muted))]">
                <summary className="cursor-pointer select-none hover:text-[hsl(var(--wb-text))]">
                  Technical details
                </summary>
                <code className="mt-2 block [overflow-wrap:anywhere] rounded-[4px] bg-[hsl(var(--wb-editor))] px-2.5 py-2 font-mono leading-4">
                  {errorPresentation.technicalDetails}
                </code>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
