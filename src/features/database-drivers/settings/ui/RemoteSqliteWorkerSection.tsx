import { SettingsDivider } from "@/features/settings/ui/SettingsFields";
import type { DriverManagementSettingsState } from "@/features/database-drivers/settings/driverManagementTypes";

type RemoteSqliteWorkerSectionProps = Pick<
  DriverManagementSettingsState,
  keyof DriverManagementSettingsState
>;

export function RemoteSqliteWorkerSection(props: RemoteSqliteWorkerSectionProps) {
  const {
    sqliteWorkerBaseUrlInput,
    setSqliteWorkerBaseUrlInput,
    packageAction,
    saveSqliteWorkerSource,
  } = props;
  return (
    <>
      <SettingsDivider title="Remote SQLite worker" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        Remote SQLite uses a small signed Linux worker over a verified SSH
        session. OxideStudio selects the x64 or ARM64 package, verifies its
        manifest and digest, and never sends database credentials to this
        source. Leave the field blank to use the source embedded in official
        builds.
      </p>
      <div className="flex items-center gap-2">
        <input
          aria-label="Remote SQLite worker source URL"
          className="h-7 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] px-2 font-mono text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
          placeholder="Official release source (leave blank)"
          value={sqliteWorkerBaseUrlInput}
          onChange={(event) => setSqliteWorkerBaseUrlInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveSqliteWorkerSource();
          }}
        />
        <button
          type="button"
          className="h-7 shrink-0 rounded-[3px] border border-[hsl(var(--wb-border))] px-2.5 text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
          disabled={packageAction.status === "loading"}
          onClick={() => void saveSqliteWorkerSource()}
        >
          Save source
        </button>
      </div>
    </>
  );
}
