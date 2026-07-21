import { useState } from "react";
import { useI18n } from "@/i18n";
import type { ConnectionDisplaySummary } from "@/startup/dataSourceDisplayCache";
import {
  peekStartupIntent,
  requestStartupIntent,
  type StartupIntent,
} from "@/startup/startupIntents";
import { useStartupProgress } from "@/startup/startupProgress";

const STARTUP_DRIVER_COLORS: Record<string, string> = {
  postgres: "#5b8dd6",
  mysql: "#d9904f",
  redis: "#d95b5b",
  elasticsearch: "#d6ad5b",
  mongodb: "#5fb878",
};

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
  const pendingDataSourceId =
    pendingIntent &&
    typeof pendingIntent !== "string" &&
    pendingIntent.type === "open-data-source"
      ? pendingIntent.connectionId
      : null;

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
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-1"
          aria-hidden="true"
        >
          <span className="h-7 w-7 rounded-[5px] bg-[hsl(var(--wb-panel-raised))]" />
          <span className="h-7 w-7 rounded-[5px] border border-[hsl(var(--wb-border-subtle))]" />
          <span className="h-7 w-7 rounded-[5px] border border-[hsl(var(--wb-border-subtle))]" />
        </div>
      </div>
      <div className="wb-workspace-track">
        <div className="wb-tool-window w-[400px] max-w-[36vw] rounded-[6px]">
          <div className="wb-tool-header border-b border-[hsl(var(--wb-border-subtle))]">
            {t("startup.databaseExplorer")}
          </div>
          <div className="h-[30px] border-b border-[hsl(var(--wb-border-subtle))]" />
          {cachedDataSources.length > 0 ? (
            <div
              className="px-1 py-1"
              aria-label={t("startup.cachedDataSources")}
            >
              {cachedDataSources.map((connection) => (
                <button
                  key={connection.id}
                  type="button"
                  className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-[3px] px-1.5 text-left text-[11px] text-[hsl(var(--wb-text-muted))] transition-colors hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() =>
                    requestIntent({
                      type: "open-data-source",
                      connectionId: connection.id,
                    })
                  }
                  aria-busy={pendingDataSourceId === connection.id}
                  title={t("startup.openDataSource", {
                    name: connection.name,
                  })}
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
                  {pendingDataSourceId === connection.id ? (
                    <span
                      className="ml-auto h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-[hsl(var(--wb-accent))]"
                      aria-label={t("startup.opening")}
                    />
                  ) : null}
                </button>
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
        <div className="wb-work-surface flex min-w-0 flex-1 flex-col rounded-[6px]">
          <div
            className="h-8 shrink-0 border-b border-[hsl(var(--wb-border-subtle))]"
            aria-hidden="true"
          />
          <div className="flex min-h-0 flex-1 items-center justify-center">
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
                    [
                      "new-query",
                      t("startup.newQuery"),
                      t("startup.newQueryDetail"),
                    ],
                    [
                      "project-files",
                      t("startup.projectFiles"),
                      t("startup.projectFilesDetail"),
                    ],
                    [
                      "command-palette",
                      t("startup.findAction"),
                      t("startup.findActionDetail"),
                    ],
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
                      {pendingIntent === intent
                        ? t("startup.opening")
                        : detail}
                    </div>
                  </button>
                ))}
              </div>
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
