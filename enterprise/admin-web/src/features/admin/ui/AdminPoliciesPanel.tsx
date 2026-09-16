import type { AdminOverview } from "../../../api";
import type { AdminSection } from "../model/adminPresentation";
import { accessActions } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminPoliciesPanelContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  createGrant: (event: React.FormEvent<Element>) => Promise<void>;
  grantProjectId: string;
  setGrantProjectId: React.Dispatch<React.SetStateAction<string>>;
  setGrantDataSourceId: React.Dispatch<React.SetStateAction<string>>;
  overview: AdminOverview | null;
  grantUserId: string;
  setGrantUserId: React.Dispatch<React.SetStateAction<string>>;
  grantDataSourceId: string;
  grantProject:
    | {
        id: string;
        displayName: string;
        memberCount: number;
        dataSourceCount: number;
        policyRevision: string;
        dataSources: {
          id: string;
          displayName: string;
          driver: string;
          targetBinding?: string | undefined;
          capabilities: string[];
          allowedResourceSummary: string[];
          gatewayId: string;
          gatewayName: string;
          gatewayStatus: string;
        }[];
      }
    | undefined;
  grantEffect: "permit" | "forbid";
  setGrantEffect: React.Dispatch<React.SetStateAction<"permit" | "forbid">>;
  grantPath: string;
  setGrantPath: React.Dispatch<React.SetStateAction<string>>;
  grantActions: string[];
  setGrantActions: React.Dispatch<React.SetStateAction<string[]>>;
  loading: boolean;
}

export function AdminPoliciesPanel({
  activeSection,
  t,
  createGrant,
  grantProjectId,
  setGrantProjectId,
  setGrantDataSourceId,
  overview,
  grantUserId,
  setGrantUserId,
  grantDataSourceId,
  grantProject,
  grantEffect,
  setGrantEffect,
  grantPath,
  setGrantPath,
  grantActions,
  setGrantActions,
  loading,
}: AdminPoliciesPanelContext) {
  return (
    <section className="module-pane" hidden={activeSection !== "policies"}>
      <SectionHeading
        title={t("Access policies")}
        detail={t(
          "Permissions are explicit, resource-scoped and deny by default. A forbid rule always wins.",
        )}
      />
      <form className="policy-form" onSubmit={createGrant}>
        <div className="inline-form">
          <label>
            {t("Project")}
            <select
              required
              value={grantProjectId}
              onChange={(event) => {
                setGrantProjectId(event.target.value);
                setGrantDataSourceId("");
              }}
            >
              <option value="">{t("Select project")}</option>
              {overview?.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Member")}
            <select
              required
              value={grantUserId}
              onChange={(event) => setGrantUserId(event.target.value)}
            >
              <option value="">{t("Select member")}</option>
              {overview?.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Data source")}
            <select
              value={grantDataSourceId}
              onChange={(event) => setGrantDataSourceId(event.target.value)}
            >
              <option value="">{t("All project data sources")}</option>
              {grantProject?.dataSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.displayName} · {source.driver}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Effect")}
            <select
              value={grantEffect}
              onChange={(event) =>
                setGrantEffect(event.target.value as "permit" | "forbid")
              }
            >
              <option value="permit">{t("Permit")}</option>
              <option value="forbid">{t("Forbid")}</option>
            </select>
          </label>
        </div>
        <label>
          {t("Resource path")}
          <input
            value={grantPath}
            placeholder={t(
              "database/schema/table — blank means the whole data source",
            )}
            onChange={(event) => setGrantPath(event.target.value)}
          />
        </label>
        <fieldset className="action-options">
          <legend>{t("Allowed actions")}</legend>
          {accessActions.map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={grantActions.includes(value)}
                onChange={(event) =>
                  setGrantActions((current) =>
                    event.target.checked
                      ? [...current, value]
                      : current.filter((action) => action !== value),
                  )
                }
              />
              {t(label)}
            </label>
          ))}
        </fieldset>
        <button
          className="primary-button"
          disabled={loading || grantActions.length === 0}
        >
          {t("Save policy")}
        </button>
      </form>
    </section>
  );
}
