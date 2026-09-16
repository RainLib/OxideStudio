import type { AdminOverview } from "../../../api";
import type { AdminSection } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminOrganizationBaselineContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  setMinimumDesktopVersion: (
    event: React.FormEvent<HTMLFormElement>,
  ) => Promise<void>;
  overview: AdminOverview | null;
  loading: boolean;
}

export function AdminOrganizationBaseline({
  activeSection,
  t,
  setMinimumDesktopVersion,
  overview,
  loading,
}: AdminOrganizationBaselineContext) {
  return (
    <section
      className="module-pane organization-baseline"
      hidden={activeSection !== "overview"}
    >
      <SectionHeading
        title={t("Desktop compatibility")}
        detail={t(
          "Older desktop builds cannot receive new managed access tickets after this version takes effect.",
        )}
      />
      <form className="inline-form" onSubmit={setMinimumDesktopVersion}>
        <label>
          {t("Minimum desktop version")}
          <input
            key={overview?.organization.minimumDesktopVersion}
            name="minimumDesktopVersion"
            required
            pattern="[0-9]+\\.[0-9]+\\.[0-9]+"
            defaultValue={
              overview?.organization.minimumDesktopVersion || "0.0.0"
            }
            title={t("Stable semantic version, for example 0.1.13")}
          />
        </label>
        <button className="primary-button" disabled={loading}>
          {t("Enforce version")}
        </button>
      </form>
    </section>
  );
}
