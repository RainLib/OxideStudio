import type { LucideProps } from "lucide-react";
import { LogOut } from "lucide-react";
import type { AdminOverview } from "../../../api";
import { adminAuth } from "../../../auth";
import type { AdminSection } from "../model/adminPresentation";

interface AdminNavigationContext {
  overview: AdminOverview | null;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  navigationItems: {
    id: AdminSection;
    label: string;
    icon: React.ForwardRefExoticComponent<
      Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>
    >;
  }[];
  activeSection: AdminSection;
}

export function AdminNavigation({
  overview,
  t,
  navigationItems,
  activeSection,
}: AdminNavigationContext) {
  return (
    <aside className="navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>OxideStudio Admin</span>
      </div>
      <div className="organization-switcher">
        <span className="organization-avatar">
          {(overview?.organization.displayName || "O")
            .slice(0, 2)
            .toUpperCase()}
        </span>
        <span>
          <strong>
            {overview?.organization.displayName || t("Organization")}
          </strong>
          <small>
            {overview?.viewerRole
              ? t(overview.viewerRole)
              : t("Loading access")}
          </small>
        </span>
      </div>
      <nav aria-label={t("Enterprise administration")}>
        {navigationItems.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            className={`nav-item ${activeSection === id ? "active" : ""}`}
            href={`#${id}`}
            aria-current={activeSection === id ? "page" : undefined}
          >
            <Icon size={16} />
            <span>{t(label)}</span>
            {activeSection === id && <i aria-hidden="true" />}
          </a>
        ))}
      </nav>
      <div className="navigation-footer">
        <button className="nav-item nav-button" onClick={adminAuth.signOut}>
          <LogOut size={16} /> <span>{t("Sign out")}</span>
        </button>
      </div>
    </aside>
  );
}
