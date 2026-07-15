import { lazy, Suspense, useState } from "react";
import { ThemeProvider } from "@/theme";
import {
  readStartupConnectionDisplayCache,
  type ConnectionDisplaySummary,
} from "@/startup/dataSourceDisplayCache";
import {
  requestStartupIntent,
  type StartupIntent,
} from "@/startup/startupIntents";

const STARTUP_DRIVER_COLORS: Record<string, string> = {
  postgres: "#5b8dd6",
  mysql: "#d9904f",
  redis: "#d95b5b",
  elasticsearch: "#d6ad5b",
  mongodb: "#5fb878",
};

const workspacePagePromise = import("@/pages/workspace");
const WorkspacePage = lazy(() =>
  workspacePagePromise.then((module) => ({
    default: module.WorkspacePage,
  })),
);

function App() {
  const cachedDataSources = readStartupConnectionDisplayCache();

  return (
    <ThemeProvider>
      <Suspense
        fallback={
          <StartupWorkbenchShell
            cachedDataSources={cachedDataSources ?? []}
            hasDataSourceCache={cachedDataSources !== null}
          />
        }
      >
        <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
          <WorkspacePage />
        </div>
      </Suspense>
    </ThemeProvider>
  );
}

export function StartupWorkbenchShell({
  cachedDataSources,
  hasDataSourceCache,
}: {
  cachedDataSources: ConnectionDisplaySummary[];
  hasDataSourceCache: boolean;
}) {
  const [pendingIntent, setPendingIntent] = useState<StartupIntent | null>(
    null,
  );
  const requestIntent = (intent: StartupIntent) => {
    setPendingIntent(intent);
    requestStartupIntent(intent);
  };

  return (
    <div
      className="workbench-shell flex flex-col"
      aria-label="Starting OxideStudio"
    >
      <div className="wb-titlebar relative flex h-9 shrink-0 items-center">
        <div
          className="absolute inset-0"
          data-tauri-drag-region
          aria-hidden="true"
        />
      </div>
      <div className="wb-workspace-track" aria-hidden="true">
        <div className="wb-tool-window w-[280px] max-w-[36vw] rounded-[6px]">
          <div className="wb-tool-header border-b border-[hsl(var(--wb-border-subtle))]">
            Database Explorer
          </div>
          <div className="h-[30px] border-b border-[hsl(var(--wb-border-subtle))]" />
          {cachedDataSources.length > 0 ? (
            <div className="px-1 py-1">
              {cachedDataSources.map((connection) => (
                <div
                  key={connection.id}
                  className="flex h-6 items-center gap-1.5 rounded-[3px] px-1.5 text-[11px] text-[hsl(var(--wb-text-muted))]"
                >
                  <span aria-hidden="true">›</span>
                  <span
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{
                      backgroundColor:
                        STARTUP_DRIVER_COLORS[connection.driver] || "#75a7ff",
                    }}
                  />
                  <span className="truncate font-medium">
                    {connection.name}
                  </span>
                </div>
              ))}
            </div>
          ) : hasDataSourceCache ? (
            <div className="px-3 py-2.5 text-[11px] text-[hsl(var(--wb-text-muted))]">
              No data sources
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-[hsl(var(--wb-text-muted))]">
              <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-orange-500" />
              <span>Loading data sources…</span>
            </div>
          )}
        </div>
        <div className="wb-work-surface flex min-w-0 flex-1 items-center justify-center rounded-[6px]">
          <div className="-translate-y-6 text-center">
            <div className="text-[14px] font-semibold text-[hsl(var(--wb-text))]">
              Start working with SQL
            </div>
            <div className="mt-1 text-[11px] text-[hsl(var(--wb-text-muted))]">
              Open a console or keep queries as files in your project directory.
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {(
                [
                  ["new-query", "New Query", "Open a SQL console"],
                  ["project-files", "Project Files", "Create or open files"],
                  ["command-palette", "Find an Action", "Open command palette"],
                ] as const
              ).map(([intent, title, detail]) => (
                <button
                  key={intent}
                  type="button"
                  className="w-[134px] rounded-[6px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-3 text-left transition-colors hover:border-[hsl(var(--wb-accent)/0.45)] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() => requestIntent(intent)}
                  aria-busy={pendingIntent === intent}
                >
                  <div className="text-[11px] font-semibold text-[hsl(var(--wb-text))]">
                    {title}
                  </div>
                  <div className="mt-1 text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {pendingIntent === intent ? "Opening…" : detail}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="h-[22px] shrink-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-status))]" />
    </div>
  );
}

export default App;
