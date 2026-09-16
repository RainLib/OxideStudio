import { Check, LogIn, ShieldCheck, Users } from "lucide-react";
import { adminAuth } from "../../../auth";
import { SectionHeading } from "./SectionHeading";

interface AdminOnboardingContext {
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  signedIn: boolean;
  createOrganization: (event: React.FormEvent<Element>) => Promise<void>;
  organizationName: string;
  setOrganizationName: React.Dispatch<React.SetStateAction<string>>;
  organizationSlug: string;
  setOrganizationSlug: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
}

export function AdminOnboarding({
  t,
  signedIn,
  createOrganization,
  organizationName,
  setOrganizationName,
  organizationSlug,
  setOrganizationSlug,
  loading,
}: AdminOnboardingContext) {
  return (
    <section className="onboarding-workspace">
      <div className="setup-introduction">
        <p className="section-kicker">{t("First-time setup")}</p>
        <h1>{t("Set up your control plane")}</h1>
        <p className="setup-copy">
          {t(
            "Initialize the organization before administrative modules become available.",
          )}
        </p>
        <ol className="setup-steps">
          <li className={signedIn ? "complete" : "current"}>
            <span>{signedIn ? <Check size={16} /> : "1"}</span>
            <div>
              <strong>{t("Connect identity provider")}</strong>
              <small>{t("Authenticate administrators through Casdoor.")}</small>
            </div>
          </li>
          <li className={signedIn ? "current" : ""}>
            <span>2</span>
            <div>
              <strong>{t("Create organization")}</strong>
              <small>{t("Establish the access and resource boundary.")}</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>{t("Invite administrators")}</strong>
              <small>{t("Add operators after initialization succeeds.")}</small>
            </div>
          </li>
        </ol>
      </div>
      <div className="setup-form-panel">
        {signedIn ? (
          <>
            <div className="identity-check">
              <span>
                <Users size={16} /> {t("Signed in as administrator")}
              </span>
              <span className="casdoor-status">
                <i /> {t("Connected")}
              </span>
            </div>
            <SectionHeading
              title={t("Create organization")}
              detail={t(
                "The signed-in identity becomes the first organization owner.",
              )}
            />
            <form className="setup-form" onSubmit={createOrganization}>
              <label>
                {t("Organization name")}
                <input
                  required
                  maxLength={128}
                  placeholder="Acme Engineering"
                  value={organizationName}
                  onChange={(event) => setOrganizationName(event.target.value)}
                />
              </label>
              <label>
                {t("Organization slug")}
                <input
                  required
                  minLength={2}
                  maxLength={64}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="acme-engineering"
                  value={organizationSlug}
                  onChange={(event) =>
                    setOrganizationSlug(event.target.value.toLowerCase())
                  }
                />
                <small>
                  {t("Used in URLs and identifiers. Choose a stable value.")}
                </small>
              </label>
              <div className="form-actions">
                <button className="primary-button" disabled={loading}>
                  {t("Create organization")}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="signin-panel">
            <ShieldCheck size={24} />
            <h2>{t("Connect Casdoor")}</h2>
            <p>
              {t(
                "Sign in with the configured identity provider to initialize this control plane.",
              )}
            </p>
            <button
              className="primary-button"
              onClick={() => void adminAuth.signIn()}
            >
              <LogIn size={14} /> {t("Sign in to continue")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
