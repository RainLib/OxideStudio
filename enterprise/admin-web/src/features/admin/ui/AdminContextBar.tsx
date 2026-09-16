import { Activity, Languages, LogIn, RefreshCw } from "lucide-react";
import type { AdminOverview } from "../../../api";
import { adminAuth } from "../../../auth";
import type { AdminLocale } from "../../../i18n";
import type { AdminSection } from "../model/adminPresentation";
import { sectionTitles } from "../model/adminPresentation";
import { organizationId } from "../runtime/adminContext";

interface AdminContextBarContext {
  signedIn: boolean;
  overview: AdminOverview | null;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  activeSection: AdminSection;
  activeGateways: number;
  refresh: () => Promise<void>;
  loading: boolean;
  locale: AdminLocale;
  setLocale: React.Dispatch<React.SetStateAction<AdminLocale>>;
}

export function AdminContextBar({
  signedIn,
  overview,
  t,
  activeSection,
  activeGateways,
  refresh,
  loading,
  locale,
  setLocale,
}: AdminContextBarContext) {
  return (
    <header className="context-bar">
      <div className="context-identity">
        {!organizationId && <span className="brand-mark" aria-hidden="true" />}
        <strong>
          {organizationId && signedIn
            ? overview?.organization.displayName || t("Organization")
            : "OxideStudio Admin"}
        </strong>
        {organizationId && signedIn && (
          <>
            <span className="context-separator">/</span>
            <span>{t(sectionTitles[activeSection])}</span>
          </>
        )}
      </div>
      <div className="header-actions">
        {organizationId && signedIn && (
          <>
            <span className="environment-status">
              <i /> {t("Production")}
            </span>
            <span className="gateway-health">
              <Activity size={14} />{" "}
              {t(
                activeGateways === 1
                  ? "{count} gateway healthy"
                  : "{count} gateways healthy",
                { count: activeGateways },
              )}
            </span>
            <button
              className="icon-button"
              onClick={() => void refresh()}
              aria-label={t("Synchronize organization")}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </>
        )}
        {!organizationId && signedIn && (
          <span className="casdoor-status">
            <i /> {t("Casdoor connected")}
          </span>
        )}
        <label className="language-control">
          <Languages size={14} aria-hidden="true" />
          <span className="sr-only">{t("Language")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as AdminLocale)}
            aria-label={t("Language")}
          >
            <option value="zh-CN">中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
        {!signedIn && (
          <button
            className="primary-button"
            onClick={() => void adminAuth.signIn()}
          >
            <LogIn size={14} /> {t("Sign in")}
          </button>
        )}
      </div>
    </header>
  );
}
