import { SettingsDivider } from "@/features/settings/ui/SettingsFields";
import type { DriverManagementSettingsState } from "@/features/database-drivers/settings/driverManagementTypes";

type ManagedJavaRuntimesSectionProps = Pick<
  DriverManagementSettingsState,
  keyof DriverManagementSettingsState
>;

export function ManagedJavaRuntimesSection(props: ManagedJavaRuntimesSectionProps) {
  const {
    javaRuntimes,
  } = props;
  return (
    <>
      <SettingsDivider title="Managed Java runtimes" />
      <p className="mb-2 max-w-[72ch] text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
        JDBC packages use only an imported, signed Java 21 runtime. The system
        Java installation and PATH are never used to launch a driver.
      </p>
      {javaRuntimes && javaRuntimes.length > 0 ? (
        <div className="border-y border-[hsl(var(--wb-border-subtle))]">
          {javaRuntimes.map((runtime) => (
            <div
              key={`${runtime.javaMajor}:${runtime.target}:${runtime.runtimeVersion}`}
              className="grid min-h-12 grid-cols-[minmax(120px,0.8fr)_minmax(170px,1fr)_minmax(150px,1fr)] items-center gap-4 border-b border-[hsl(var(--wb-border-subtle))] py-2 last:border-b-0"
            >
              <div className="text-[12px] font-medium text-[hsl(var(--wb-text))]">
                Java {runtime.javaMajor}
              </div>
              <div className="font-mono text-[11px] text-[hsl(var(--wb-text))]">
                {runtime.runtimeVersion}
              </div>
              <div className="text-[11px] leading-4 text-[hsl(var(--wb-text-muted))]">
                <div>
                  {runtime.active ? "Active" : "Installed"} · {runtime.target}
                </div>
                {runtime.status !== "ready" && (
                  <div
                    className="text-[hsl(var(--destructive))]"
                    title={runtime.statusMessage || undefined}
                  >
                    Runtime verification failed
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-[hsl(var(--wb-text-muted))]">
          No managed Java runtime installed.
        </p>
      )}
    </>
  );
}
