import { SettingsDivider } from "@/features/settings/ui/SettingsFields";
import { cn } from "@/lib/utils";
import type { DriverManagementSettingsState } from "@/features/database-drivers/settings/driverManagementTypes";

type SignedDriverCatalogSectionProps = Pick<
  DriverManagementSettingsState,
  keyof DriverManagementSettingsState
>;

export function SignedDriverCatalogSection(props: SignedDriverCatalogSectionProps) {
  const {
    catalogUrlInput,
    setCatalogUrlInput,
    catalogStatus,
    checkCatalog,
    catalogEntries,
    installations,
    packageAction,
    installCatalogPackage,
  } = props;
  return (
    <>
      <SettingsDivider title="Signed package catalog" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Check a signed HTTPS catalog for independently released packages. A
        release can be installed only when its signed entry includes an archive
        SHA-256; download, digest verification, package verification, and
        activation checks still run locally. Java dependencies may be fetched
        only when the same signed entry fixes their Maven coordinates, classpath
        paths, sizes, SHA-256 digests, and SPDX licenses on an allowlisted
        repository. Verified release archives and dependencies are reused only
        after their digests are checked again. Entries without an archive digest
        remain review-and-import only.
      </p>
      <div className="flex items-center gap-2">
        <input
          aria-label="Signed driver catalog URL"
          className="h-7 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
          placeholder="https://drivers.example.com/catalog.json"
          value={catalogUrlInput}
          onChange={(event) => setCatalogUrlInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void checkCatalog();
          }}
        />
        <button
          type="button"
          className="h-7 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
          disabled={catalogStatus.status === "loading"}
          onClick={() => void checkCatalog()}
        >
          {catalogStatus.status === "loading" ? "Checking…" : "Check catalog"}
        </button>
      </div>
      {"message" in catalogStatus && (
        <p
          role={catalogStatus.status === "error" ? "alert" : "status"}
          className={cn(
            "mt-1.5 text-[11px]",
            catalogStatus.status === "error"
              ? "text-[hsl(var(--destructive))]"
              : "text-[hsl(var(--wb-text-muted))]",
          )}
        >
          {catalogStatus.message}
        </p>
      )}
      {catalogEntries && catalogEntries.length > 0 && (
        <div className="mt-2 border-y border-[hsl(var(--wb-border-subtle))]">
          {catalogEntries.map((entry) => {
            const matchingInstallations = (installations || []).filter(
              (installation) =>
                installation.distribution === "external" &&
                installation.driver === entry.driverId,
            );
            const exactInstall = matchingInstallations.find(
              (installation) =>
                installation.packageVersion === entry.packageVersion,
            );
            const installedLabel = exactInstall
              ? exactInstall.active
                ? "Active"
                : "Installed"
              : matchingInstallations[0]?.packageVersion
                ? `Installed ${matchingInstallations[0].packageVersion}`
                : null;
            const capabilityLabel = entry.capabilities
              ? `${entry.capabilities.dataModel} · ${entry.capabilities.lspLanguageId} intelligence`
              : null;
            const serverVersionLabel = entry.serverVersionRange?.trim()
              ? `Server compatibility: ${entry.serverVersionRange.trim()}`
              : null;
            const connectVersions = entry.conformance?.connect || [];
            const metadataVersions = entry.conformance?.metadata || [];
            const queryVersions = entry.conformance?.query || [];
            const mutationVersions = entry.conformance?.mutations || [];
            const migrationVersions = entry.conformance?.migration || [];
            const transferVersions = entry.conformance?.dataTransfer || [];
            const dependencies = entry.dependencies || [];
            const conformanceLabel =
              [
                connectVersions.length
                  ? `Connect verified: ${connectVersions.join(", ")}`
                  : null,
                metadataVersions.length
                  ? `Metadata verified: ${metadataVersions.join(", ")}`
                  : null,
                queryVersions.length
                  ? `Query verified: ${queryVersions.join(", ")}`
                  : null,
                mutationVersions.length
                  ? `Grid edits verified: ${mutationVersions.join(", ")}`
                  : null,
                migrationVersions.length
                  ? `Migration verified: ${migrationVersions.join(", ")}`
                  : null,
                transferVersions.length
                  ? `Transfer verified: ${transferVersions.join(", ")}`
                  : null,
              ]
                .filter((value): value is string => Boolean(value))
                .join(" · ") || null;
            return (
              <div
                key={`${entry.driverId}:${entry.packageVersion}`}
                className="grid grid-cols-[minmax(120px,0.8fr)_minmax(130px,1fr)_minmax(160px,1fr)] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] py-1.5 text-[11px] last:border-b-0"
              >
                <span className="min-w-0" title={entry.driverId}>
                  <span className="block truncate text-[hsl(var(--wb-text))]">
                    {entry.displayName}
                  </span>
                  {capabilityLabel && (
                    <span
                      className="block truncate text-[10px] text-[hsl(var(--wb-text-muted))]"
                      title={capabilityLabel}
                    >
                      {capabilityLabel}
                    </span>
                  )}
                  {serverVersionLabel && (
                    <span
                      className="block truncate text-[10px] text-[hsl(var(--wb-text-muted))]"
                      title={serverVersionLabel}
                    >
                      {serverVersionLabel}
                    </span>
                  )}
                  {conformanceLabel && (
                    <span
                      className="block truncate text-[10px] text-[hsl(var(--wb-text-muted))]"
                      title={conformanceLabel}
                    >
                      {conformanceLabel}
                    </span>
                  )}
                </span>
                <span className="min-w-0 truncate font-mono text-[hsl(var(--wb-text-muted))]">
                  {entry.packageVersion} · protocol {entry.protocolVersion}
                </span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  {installedLabel && (
                    <span
                      className="truncate text-[hsl(var(--wb-text-muted))]"
                      title={installedLabel}
                    >
                      {installedLabel}
                    </span>
                  )}
                  {entry.archiveSha256 && !exactInstall && (
                    <button
                      type="button"
                      className="shrink-0 text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={packageAction.status === "loading"}
                      onClick={() => void installCatalogPackage(entry)}
                      title="Download this signed release, verify its archive digest and package signature, then activate it if no live connection uses another version"
                    >
                      {packageAction.status === "loading" &&
                      packageAction.key ===
                        `catalog-install:${entry.driverId}:${entry.packageVersion}`
                        ? "Installing…"
                        : "Install"}
                    </button>
                  )}
                  <a
                    className="min-w-0 truncate text-[hsl(var(--wb-accent))] hover:underline"
                    href={entry.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the package download location"
                  >
                    Review download
                  </a>
                </span>
                {dependencies.length > 0 && (
                  <details className="group col-span-3 border-t border-[hsl(var(--wb-border-subtle))] pt-1">
                    <summary className="cursor-pointer list-none text-[10px] text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]">
                      {dependencies.length} signed JDBC dependenc
                      {dependencies.length === 1 ? "y" : "ies"}
                      {" · "}
                      {(
                        dependencies.reduce(
                          (total, dependency) => total + dependency.sizeBytes,
                          0,
                        ) /
                        1024 /
                        1024
                      ).toFixed(1)}{" "}
                      MiB
                      <span className="ml-1 group-open:hidden">
                        · Show licenses
                      </span>
                    </summary>
                    <div className="mt-1 space-y-1 pb-1">
                      {dependencies.map((dependency) => (
                        <div
                          key={`${dependency.coordinate}:${dependency.path}`}
                          className="grid grid-cols-[minmax(180px,1fr)_minmax(90px,0.45fr)_auto] gap-2 font-mono text-[9px] text-[hsl(var(--wb-text-muted))]"
                        >
                          <span
                            className="truncate"
                            title={dependency.coordinate}
                          >
                            {dependency.coordinate}
                          </span>
                          <span className="truncate" title={dependency.path}>
                            {dependency.path}
                          </span>
                          <a
                            className="text-[hsl(var(--wb-accent))] hover:underline"
                            href={dependency.licenseUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`Review ${dependency.licenseSpdx} license`}
                          >
                            {dependency.licenseSpdx}
                          </a>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
