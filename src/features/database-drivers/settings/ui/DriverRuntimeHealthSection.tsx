import { SettingsDivider } from "@/features/settings/ui/SettingsFields";
import type { DriverManagementSettingsState } from "@/features/database-drivers/settings/driverManagementTypes";

type DriverRuntimeHealthSectionProps = Pick<
  DriverManagementSettingsState,
  keyof DriverManagementSettingsState
>;

export function DriverRuntimeHealthSection(props: DriverRuntimeHealthSectionProps) {
  const {
    driverRuntimes,
    packageAction,
    refreshDriverRuntimes,
    reconnectDriverRuntime,
  } = props;
  return (
    <>
      {driverRuntimes && driverRuntimes.length > 0 && (
        <>
          <SettingsDivider title="Active external driver runtimes" />
          <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-[hsl(var(--wb-text-muted))]">
            <span>
              Connection-owned sidecars. Only exited runtimes can be
              reconnected; driver output is never retained.
            </span>
            <button
              type="button"
              className="shrink-0 text-[10px] text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              onClick={() => void refreshDriverRuntimes()}
              title="Refresh active external driver runtimes"
            >
              Refresh
            </button>
          </div>
          <div className="border-y border-[hsl(var(--wb-border-subtle))]">
            {driverRuntimes.map((runtime) => (
              <div
                key={`${runtime.driver}:${runtime.packageVersion}`}
                className="grid min-h-10 grid-cols-[minmax(110px,0.8fr)_minmax(110px,0.8fr)_minmax(0,1fr)] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1.5 text-[10px] last:border-b-0"
              >
                <span className="min-w-0 truncate font-medium text-[hsl(var(--wb-text))]">
                  {runtime.driver}
                </span>
                <span className="truncate font-mono text-[hsl(var(--wb-text-muted))]">
                  package {runtime.packageVersion}
                </span>
                <div className="min-w-0 text-right text-[hsl(var(--wb-text-muted))]">
                  {runtime.connectionCount} connection
                  {runtime.connectionCount === 1 ? "" : "s"}
                  {runtime.processIds.length > 0 && (
                    <span
                      title={`Sidecar PID: ${runtime.processIds.join(", ")}`}
                    >
                      {" "}
                      · {runtime.processIds.length} process
                      {runtime.processIds.length === 1 ? "" : "es"}
                    </span>
                  )}
                  {runtime.launchCount > 0 && (
                    <span
                      title={`Observed since this desktop process started${runtime.lastStartedAtMillis ? `. Latest launch: ${new Date(runtime.lastStartedAtMillis).toLocaleString()}` : ""}.`}
                    >
                      {" "}
                      ({runtime.launchCount} launch
                      {runtime.launchCount === 1 ? "" : "es"})
                    </span>
                  )}
                  {runtime.unavailableProcessCount > 0 && (
                    <span
                      className="text-amber-400"
                      title="A connected driver entry has no observable sidecar process id. Reconnect it if work fails."
                    >
                      {" "}
                      · {runtime.unavailableProcessCount} unavailable
                    </span>
                  )}
                  {runtime.unhealthyConnectionCount > 0 && (
                    <span
                      className="text-red-400"
                      title="A registered external connection owns a sidecar that has exited. Reconnect the affected data source before continuing."
                    >
                      {" "}
                      · {runtime.unhealthyConnectionCount} exited
                    </span>
                  )}
                  {runtime.observedExitCount > 0 && (
                    <span
                      className="text-amber-400"
                      title={`Observed since this desktop process started${runtime.lastExitObservedAtMillis ? `. Latest observed exit: ${new Date(runtime.lastExitObservedAtMillis).toLocaleString()}` : ""}. Driver output is not retained.`}
                    >
                      {" "}
                      ({runtime.observedExitCount} observed exit
                      {runtime.observedExitCount === 1 ? "" : "s"})
                    </span>
                  )}
                  {runtime.reconnectAttemptCount > 0 && (
                    <span
                      title={`Sanitized lifecycle telemetry only${runtime.lastReconnectAtMillis ? `. Latest reconnect activity: ${new Date(runtime.lastReconnectAtMillis).toLocaleString()}` : ""}. No connection identity or driver output is stored.`}
                    >
                      {" "}
                      · {runtime.reconnectSuccessCount}/
                      {runtime.reconnectAttemptCount} reconnects
                    </span>
                  )}
                  {runtime.unhealthyConnectionCount > 0 && (
                    <button
                      type="button"
                      className="ml-2 text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        packageAction.status === "loading" ||
                        !runtime.reconnectAvailable
                      }
                      onClick={() => void reconnectDriverRuntime(runtime)}
                      title={
                        runtime.reconnectAvailable
                          ? "Reconnect only connection-owned sidecars already observed exited"
                          : "Reconnect is temporarily limited after repeated failures to prevent a crash loop"
                      }
                    >
                      {packageAction.status === "loading" &&
                      packageAction.key ===
                        `runtime-reconnect:${runtime.driver}:${runtime.packageVersion}`
                        ? "Reconnecting…"
                        : "Reconnect exited"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
