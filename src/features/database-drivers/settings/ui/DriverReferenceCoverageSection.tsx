import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  referenceDriverPackageRequirement,
} from "@/features/database-drivers";
import { SettingsDivider } from "@/features/settings/ui/SettingsFields";
import { cn } from "@/lib/utils";
import type { DriverManagementSettingsState } from "@/features/database-drivers/settings/driverManagementTypes";

type DriverReferenceCoverageSectionProps = Pick<
  DriverManagementSettingsState,
  keyof DriverManagementSettingsState
>;

export function DriverReferenceCoverageSection(props: DriverReferenceCoverageSectionProps) {
  const {
    candidateCoverage,
    candidateAvailability,
    catalogEntries,
    packageAction,
    installCatalogPackage,
  } = props;
  return (
    <>
      <SettingsDivider title="Reference package coverage" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        {REFERENCE_DATABASE_DRIVER_CANDIDATES.length} database products are
        tracked: {candidateCoverage.bundled} bundled,{" "}
        {candidateCoverage.activePackage} active package
        {candidateCoverage.activePackage === 1 ? "" : "s"} (
        {candidateCoverage.activeRecorded} with recorded version evidence
        {candidateCoverage.activeUnrecorded
          ? `, ${candidateCoverage.activeUnrecorded} unrecorded`
          : ""}
        ), and {candidateCoverage.requiresPackage} awaiting a signed package.
        These rows are planning and package-discovery metadata, never connection
        choices by themselves.
      </p>
      <details
        className="group border-y border-[hsl(var(--wb-border-subtle))]"
        data-testid="reference-driver-coverage"
      >
        <summary className="flex h-8 cursor-pointer list-none items-center justify-between gap-3 px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]">
          <span>Show tracked driver products</span>
          <span className="font-mono text-[10px] group-open:hidden">
            {REFERENCE_DATABASE_DRIVER_CANDIDATES.length} products
          </span>
          <span className="hidden font-mono text-[10px] group-open:inline">
            Hide list
          </span>
        </summary>
        <div className="max-h-64 overflow-y-auto border-t border-[hsl(var(--wb-border-subtle))]">
          {candidateAvailability.map(
            ({ candidate, availability, conformance, delivery }) => {
              const catalogRelease = catalogEntries?.find(
                (entry) => entry.driverId === candidate.driver,
              );
              const availabilityLabel =
                conformance.state === "bundled"
                  ? "Bundled"
                  : conformance.state === "activeRecorded"
                    ? `Verified: ${conformance.verifiedVersions.join(", ")}`
                    : conformance.state === "activeUnrecorded"
                      ? "Active · no version evidence"
                      : catalogRelease
                        ? `Release ${catalogRelease.packageVersion}`
                        : referenceDriverPackageRequirement(candidate) ||
                          "Package required";
              const availabilityClassName =
                conformance.state === "notInstalled"
                  ? "text-[hsl(var(--wb-text-muted))]"
                  : conformance.state === "activeUnrecorded"
                    ? "text-amber-400"
                    : "text-[hsl(var(--wb-accent))]";
              return (
                <div
                  key={candidate.driver}
                  className="grid min-h-8 grid-cols-[minmax(140px,1fr)_minmax(88px,0.5fr)_minmax(124px,0.65fr)_minmax(110px,0.55fr)_auto] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1 last:border-b-0"
                >
                  <span
                    className="flex min-w-0 items-center gap-1.5 text-[11px] text-[hsl(var(--wb-text))]"
                    title={candidate.driver}
                  >
                    <DatabaseBrandIcon
                      driver={candidate.driver}
                      size={12}
                      className="shrink-0"
                    />
                    <span className="truncate">{candidate.displayName}</span>
                  </span>
                  <span className="truncate font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
                    {candidate.dataModel} · {candidate.preferredRuntime}
                  </span>
                  <span
                    className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]"
                    title={
                      delivery.lspRoute === "notApplicable"
                        ? "This product needs its own workspace and language provider; it is never routed into the SQL Grid."
                        : `After the matching signed runtime is active: ${delivery.lspLabel}.`
                    }
                  >
                    {delivery.lspLabel}
                  </span>
                  <span
                    className={cn(
                      "truncate text-right text-[10px]",
                      availabilityClassName,
                    )}
                    title={
                      conformance.state === "activeUnrecorded"
                        ? "The active signed package has no matching signed-catalog server-version conformance record."
                        : conformance.state === "activeRecorded"
                          ? `Matching signed release verified against: ${conformance.verifiedVersions.join(", ")}`
                          : undefined
                    }
                  >
                    {availabilityLabel}
                  </span>
                  {availability === "requiresPackage" &&
                    catalogRelease?.archiveSha256 && (
                      <button
                        type="button"
                        className="col-start-5 justify-self-end text-[10px] text-[hsl(var(--wb-accent))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={packageAction.status === "loading"}
                        onClick={() =>
                          void installCatalogPackage(catalogRelease)
                        }
                        title="Install this signed package release after archive and manifest verification"
                      >
                        {packageAction.status === "loading" &&
                        packageAction.key ===
                          `catalog-install:${catalogRelease.driverId}:${catalogRelease.packageVersion}`
                          ? "Installing…"
                          : "Install"}
                      </button>
                    )}
                </div>
              );
            },
          )}
        </div>
      </details>
    </>
  );
}
