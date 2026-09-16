import {
  Database,
  FolderKanban,
  Network,
  RefreshCw,
  Users,
} from "lucide-react";
import type { AdminOverview } from "../../../api";
import type { AdminSection } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminOverviewPanelContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  refresh: () => Promise<void>;
  loading: boolean;
  overview: AdminOverview | null;
  activeGateways: number;
}

export function AdminOverviewPanel({
  activeSection,
  t,
  refresh,
  loading,
  overview,
  activeGateways,
}: AdminOverviewPanelContext) {
  return (
    <section
      className="module-pane"
      hidden={activeSection !== "overview"}
      aria-label={t("Overview")}
    >
      <SectionHeading
        title={t("Organization overview")}
        detail={t(
          "Operational readiness and the boundaries that currently control managed access.",
        )}
        action={
          <button className="quiet-button" onClick={() => void refresh()}>
            <RefreshCw size={14} className={loading ? "spin" : ""} />{" "}
            {t("Refresh")}
          </button>
        }
      />
      <div className="overview-workspace">
        <div className="overview-primary">
          <h3>{t("Control plane status")}</h3>
          <div className="status-row">
            <span>
              <Users size={16} /> {t("Members")}
            </span>
            <strong>{overview?.members.length ?? 0}</strong>
            <a href="#members">{t("Manage")}</a>
          </div>
          <div className="status-row">
            <span>
              <FolderKanban size={16} /> {t("Projects")}
            </span>
            <strong>{overview?.projects.length ?? 0}</strong>
            <a href="#projects">{t("Manage")}</a>
          </div>
          <div className="status-row">
            <span>
              <Database size={16} /> {t("Data sources")}
            </span>
            <strong>
              {overview?.projects.reduce(
                (total, project) => total + project.dataSourceCount,
                0,
              ) ?? 0}
            </strong>
            <a href="#infrastructure">{t("Manage")}</a>
          </div>
          <div className="status-row">
            <span>
              <Network size={16} /> {t("Active gateways")}
            </span>
            <strong>{activeGateways}</strong>
            <a href="#infrastructure">{t("Manage")}</a>
          </div>
        </div>
        <aside className="readiness-panel">
          <span className="readiness-label">{t("Environment")}</span>
          <strong>
            <i /> {t("Production")}
          </strong>
          <p>
            {t(
              "Identity, projects and gateway boundaries are enforced by the control plane.",
            )}
          </p>
          <dl>
            <div>
              <dt>{t("Your role")}</dt>
              <dd>{overview?.viewerRole ? t(overview.viewerRole) : ""}</dd>
            </div>
            <div>
              <dt>{t("Desktop minimum")}</dt>
              <dd>{overview?.organization.minimumDesktopVersion}</dd>
            </div>
            <div>
              <dt>{t("Organization ID")}</dt>
              <dd>
                <code>{overview?.organization.id}</code>
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
