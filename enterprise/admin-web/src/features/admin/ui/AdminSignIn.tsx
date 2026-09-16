import { LogIn, ShieldCheck } from "lucide-react";
import { adminAuth } from "../../../auth";

interface AdminSignInContext {
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
}

export function AdminSignIn({ t }: AdminSignInContext) {
  return (
    <section className="signin-workspace">
      <div className="signin-panel">
        <ShieldCheck size={26} />
        <p className="section-kicker">{t("Identity required")}</p>
        <h1>{t("Sign in to administer OxideStudio")}</h1>
        <p>
          {t(
            "Authenticate with Casdoor before organization settings and management modules become available.",
          )}
        </p>
        <button
          className="primary-button"
          onClick={() => void adminAuth.signIn()}
        >
          <LogIn size={14} /> {t("Sign in with Casdoor")}
        </button>
      </div>
    </section>
  );
}
