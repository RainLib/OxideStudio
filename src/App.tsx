import { lazy, Suspense, useEffect, useState } from "react";
import { ThemeProvider } from "@/theme";
import { AppPreferencesProvider, useI18n } from "@/i18n";
import {
  readStartupConnectionDisplayCache,
  type ConnectionDisplaySummary,
} from "@/startup/dataSourceDisplayCache";
import {
  peekStartupIntent,
  requestStartupIntent,
  type StartupIntent,
} from "@/startup/startupIntents";
import {
  markReactShellReady,
  markWorkspaceModuleReady,
  useStartupProgress,
} from "@/startup/startupProgress";

const STARTUP_DRIVER_COLORS: Record<string, string> = {
  postgres: "#5b8dd6",
  mysql: "#d9904f",
  redis: "#d95b5b",
  elasticsearch: "#d6ad5b",
  mongodb: "#5fb878",
};

// Start fetching and transforming the workspace as soon as the App module is
// evaluated. The second import reuses the browser module cache when React asks
// lazy() for the component. This removes the previous App -> first effect ->
// animation frame -> workspace request waterfall while Suspense still lets the
// lightweight shell paint first.
void import("@/pages/workspace");
const WorkspacePage = lazy(() =>
  import("@/pages/workspace").then((module) => {
    markWorkspaceModuleReady();
    return {
      default: module.WorkspacePage,
    };
  }),
);

function App() {
  const cachedDataSources = readStartupConnectionDisplayCache();

  useEffect(() => {
    markReactShellReady();
    window.dispatchEvent(new Event("oxide:react-shell-ready"));
  }, []);

  return (
    <ThemeProvider>
      <AppPreferencesProvider>
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
      </AppPreferencesProvider>
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
  const { t } = useI18n();
  const [pendingIntent, setPendingIntent] = useState<StartupIntent | null>(
    () => peekStartupIntent(),
  );
  const startupProgress = useStartupProgress();
  const requestIntent = (intent: StartupIntent) => {
    setPendingIntent(intent);
    requestStartupIntent(intent);
  };

  return (
    <div
      className="workbench-shell flex flex-col"
      aria-label={t("startup.ariaLabel")}
    >
      <div className="wb-titlebar relative flex h-9 shrink-0 items-center">
        <div
          className="absolute inset-0"
          data-tauri-drag-region
          aria-hidden="true"
        />
      </div>
      <div className="wb-workspace-track">
        <div className="wb-tool-window w-[400px] max-w-[36vw] rounded-[6px]">
          <div className="wb-tool-header border-b border-[hsl(var(--wb-border-subtle))]">
            {t("startup.databaseExplorer")}
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
              {t("startup.noDataSources")}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-[hsl(var(--wb-text-muted))]">
              <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-orange-500" />
              <span>{t("startup.loadingDataSources")}</span>
            </div>
          )}
        </div>
        <div className="wb-work-surface flex min-w-0 flex-1 items-center justify-center rounded-[6px]">
          <div className="-translate-y-6 text-center">
            <div className="text-[14px] font-semibold text-[hsl(var(--wb-text))]">
              {t("startup.title")}
            </div>
            <div className="mt-1 text-[11px] text-[hsl(var(--wb-text-muted))]">
              {t("startup.description")}
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
      <div
        className="flex h-[22px] shrink-0 items-center justify-end gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-status))] px-2 text-[10px] text-[hsl(var(--wb-text-muted))]"
        role="status"
        aria-live="polite"
      >
        <span className="whitespace-nowrap">{startupProgress.label}</span>
        <span
          className="wb-progress-track"
          role="progressbar"
          aria-label={startupProgress.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(startupProgress.progress * 100)}
        >
          <span
            className="wb-progress-bar wb-progress-bar-determinate"
            style={{
              transform: `scaleX(${startupProgress.progress})`,
            }}
          />
        </span>
      </div>
    </div>
  );
}

export default App;
