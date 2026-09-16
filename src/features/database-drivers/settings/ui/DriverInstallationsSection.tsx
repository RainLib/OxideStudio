import {
  SettingsDivider,
} from "@/features/settings/ui/SettingsFields";
import { cn } from "@/lib/utils";
import type { DriverManagementSettingsState } from "@/features/database-drivers/settings/driverManagementTypes";

type DriverInstallationsSectionProps = Pick<
  DriverManagementSettingsState,
  keyof DriverManagementSettingsState
>;

export function DriverInstallationsSection(props: DriverInstallationsSectionProps) {
  const {
    installations,
    driverStore,
    loadError,
    probeStates,
    packageAction,
    cleanDriverCache,
    migrateDriverStore,
    importJavaRuntime,
    importPackage,
    activatePackage,
    rollbackPackage,
    probePackage,
  } = props;
  return (
    <>
      <SettingsDivider title="Installed database clients" first />
      <p className="mb-3 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        This inventory combines bundled recovery drivers with discovered
        external packages. An external package is enabled only after its
        signature, target, protocol, and executable digest are verified.
      </p>
      {driverStore && (
        <div className="mb-3 flex items-center gap-2 border-y border-[hsl(var(--wb-border-subtle))] py-2 text-[11px]">
          <div className="min-w-0 flex-1">
            <div className="text-[hsl(var(--wb-text-muted))]">Driver Store</div>
            <div
              className="truncate font-mono text-[hsl(var(--wb-text))]"
              title={driverStore.activePath}
            >
              {driverStore.activePath}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="h-6 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
              disabled={packageAction.status === "loading"}
              onClick={() => void cleanDriverCache()}
              title="Remove disposable catalog downloads while keeping active, rollback, connection-pinned, and running package versions"
            >
              {packageAction.status === "loading" &&
              packageAction.key === "prune-cache"
                ? "Cleaning..."
                : "Clean cache"}
            </button>
            <button
              type="button"
              className="h-6 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
              disabled={packageAction.status === "loading"}
              onClick={() => void migrateDriverStore()}
            >
              {packageAction.status === "loading" &&
              packageAction.key === "migrate-store"
                ? "Migrating…"
                : "Move…"}
            </button>
          </div>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-3">
        <span
          role={packageAction.status === "error" ? "alert" : "status"}
          className={cn(
            "min-w-0 truncate text-[11px]",
            packageAction.status === "error"
              ? "text-[hsl(var(--destructive))]"
              : "text-[hsl(var(--wb-text-muted))]",
          )}
          title={"message" in packageAction ? packageAction.message : undefined}
        >
          {"message" in packageAction ? packageAction.message : ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="h-7 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
            disabled={packageAction.status === "loading"}
            onClick={() => void importJavaRuntime()}
          >
            {packageAction.status === "loading" &&
            packageAction.key === "import-java"
              ? "Installing…"
              : "Import Java runtime…"}
          </button>
          <button
            type="button"
            className="h-7 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
            disabled={packageAction.status === "loading"}
            onClick={() => void importPackage()}
          >
            {packageAction.status === "loading" &&
            packageAction.key === "import"
              ? "Installing…"
              : "Import package…"}
          </button>
        </div>
      </div>
      {loadError && (
        <p
          role="alert"
          className="py-2 text-[12px] text-[hsl(var(--destructive))]"
        >
          {loadError}
        </p>
      )}
      {!installations && !loadError && (
        <div
          aria-label="Loading database drivers"
          className="border-y border-[hsl(var(--wb-border-subtle))]"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="flex h-14 animate-pulse items-center gap-4 border-b border-[hsl(var(--wb-border-subtle))] last:border-b-0 motion-reduce:animate-none"
            >
              <span className="h-3 w-28 rounded-[3px] bg-[hsl(var(--wb-hover))]" />
              <span className="h-3 w-40 rounded-[3px] bg-[hsl(var(--wb-hover))]" />
            </div>
          ))}
        </div>
      )}
      {installations && (
        <div className="border-y border-[hsl(var(--wb-border-subtle))]">
          {installations.map((installation) => {
            const packageKey = `${installation.driver}:${installation.packageVersion || "active"}`;
            const probeState = probeStates[packageKey];
            return (
              <div
                key={`${installation.driver}:${installation.distribution}:${installation.packageVersion || installation.clientVersion}`}
                className="grid min-h-14 grid-cols-[minmax(120px,0.8fr)_minmax(170px,1fr)_minmax(150px,1fr)] items-center gap-4 border-b border-[hsl(var(--wb-border-subtle))] py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-[hsl(var(--wb-text))]">
                    {installation.displayName}
                  </div>
                  <div className="truncate text-[11px] text-[hsl(var(--wb-text-muted))]">
                    {installation.driver}
                  </div>
                </div>
                <div className="min-w-0 font-mono text-[11px] text-[hsl(var(--wb-text))]">
                  <span className="break-all">
                    {installation.clientLibrary}
                  </span>{" "}
                  <span className="text-[hsl(var(--wb-text-muted))]">
                    {installation.clientVersion}
                  </span>
                </div>
                <div className="min-w-0 text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  <div>{installation.implementation}</div>
                  <div>
                    {installation.distribution === "external"
                      ? `${installation.active ? "Active" : "Installed"} · package ${installation.packageVersion || "unknown"}`
                      : "Bundled · updates with OxideStudio"}
                  </div>
                  {installation.runtime && <div>{installation.runtime}</div>}
                  {installation.runtimeReady === false && (
                    <div className="text-[hsl(var(--destructive))]">
                      Import a signed Java runtime before connecting.
                    </div>
                  )}
                  {installation.status && installation.status !== "ready" && (
                    <div
                      className="text-[hsl(var(--destructive))]"
                      title={installation.statusMessage || undefined}
                    >
                      {installation.status === "invalid"
                        ? "Package verification failed"
                        : installation.status === "untrusted"
                          ? "Package signature is not trusted"
                          : "Package is incompatible"}
                    </div>
                  )}
                  {installation.distribution === "external" &&
                    installation.status === "ready" && (
                      <div className="mt-1.5 flex min-w-0 items-center gap-2">
                        {!installation.active &&
                          installation.packageVersion && (
                            <button
                              type="button"
                              className="h-6 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                              disabled={packageAction.status === "loading"}
                              onClick={() => void activatePackage(installation)}
                            >
                              {packageAction.status === "loading" &&
                              packageAction.key ===
                                `activate:${installation.driver}:${installation.packageVersion}`
                                ? "Activating…"
                                : "Activate"}
                            </button>
                          )}
                        {installation.active && (
                          <button
                            type="button"
                            className="h-6 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                            disabled={
                              probeState?.status === "loading" ||
                              packageAction.status === "loading"
                            }
                            onClick={() => void probePackage(installation)}
                          >
                            {probeState?.status === "loading"
                              ? "Verifying…"
                              : "Verify package"}
                          </button>
                        )}
                        {installation.active && installation.canRollback && (
                          <button
                            type="button"
                            className="h-6 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                            disabled={packageAction.status === "loading"}
                            onClick={() => void rollbackPackage(installation)}
                          >
                            {packageAction.status === "loading" &&
                            packageAction.key ===
                              `rollback:${installation.driver}`
                              ? "Rolling back…"
                              : "Rollback"}
                          </button>
                        )}
                        {probeState?.status === "success" && (
                          <span className="truncate text-[10px] text-[hsl(var(--wb-accent))]">
                            Started · query
                            {probeState.result.supportsMetadata
                              ? " + metadata"
                              : ""}
                            {probeState.result.supportsTransactions
                              ? " + transactions"
                              : ""}
                            {probeState.result.supportsTableRowMutation
                              ? " + grid edits"
                              : ""}
                            {probeState.result.supportsTableDataTransfer
                              ? " + table transfer"
                              : ""}
                            {probeState.result.tableExportFormats.length > 0
                              ? ` + exports ${probeState.result.tableExportFormats
                                  .map((format) => format.toUpperCase())
                                  .join("/")}`
                              : ""}
                            {probeState.result.supportsSemanticSchemaMigration
                              ? " + semantic migration"
                              : ""}
                            {probeState.result.supportsAgentReadOnlyEnforcement
                              ? " + Agent read-only"
                              : ""}
                          </span>
                        )}
                        {probeState?.status === "error" && (
                          <span
                            role="alert"
                            className="truncate text-[10px] text-[hsl(var(--destructive))]"
                            title={probeState.message}
                          >
                            Verification failed
                          </span>
                        )}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
