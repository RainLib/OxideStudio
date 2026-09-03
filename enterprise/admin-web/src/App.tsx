import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Building2,
  Check,
  Database,
  FolderKanban,
  KeyRound,
  Languages,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  ScrollText,
  ServerCog,
  ShieldCheck,
  LogIn,
  LogOut,
  Users,
} from "lucide-react";
import {
  adminApi,
  type AdminAuditEvent,
  type GatewayCertificateRotation,
  type AdminOverview,
  type GatewayRegistration,
} from "./api";
import { adminAuth } from "./auth";
import {
  initialAdminLocale,
  saveAdminLocale,
  translate,
  type AdminLocale,
} from "./i18n";

const organizationId = adminAuth.organizationId();
const accessActions = [
  ["resourceDiscover", "Discover"],
  ["metadataRead", "Metadata"],
  ["queryRead", "Read query"],
] as const;

const driverProfiles: Record<string, { label: string; model: string }> = {
  postgres: { label: "PostgreSQL", model: "Relational SQL" },
  postgresql: { label: "PostgreSQL", model: "Relational SQL" },
  mysql: { label: "MySQL", model: "Relational SQL" },
  mongodb: { label: "MongoDB", model: "Document database" },
  mongo: { label: "MongoDB", model: "Document database" },
  elasticsearch: { label: "Elasticsearch", model: "Search index" },
  elastic: { label: "Elasticsearch", model: "Search index" },
  redis: { label: "Redis", model: "Key-value store" },
};

type AdminSection =
  | "overview"
  | "members"
  | "projects"
  | "infrastructure"
  | "policies"
  | "audit";

const sectionTitles: Record<AdminSection, string> = {
  overview: "Overview",
  members: "Members",
  projects: "Projects",
  infrastructure: "Infrastructure",
  policies: "Access policies",
  audit: "Audit",
};

function sectionFromHash(): AdminSection {
  const hash = window.location.hash.slice(1);
  if (hash === "gateways") return "infrastructure";
  if (
    hash === "members" ||
    hash === "projects" ||
    hash === "infrastructure" ||
    hash === "policies" ||
    hash === "audit"
  ) {
    return hash;
  }
  return "overview";
}

export function App() {
  const [activeSection, setActiveSection] = useState<AdminSection>(sectionFromHash);
  const [locale, setLocale] = useState<AdminLocale>(initialAdminLocale);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [infrastructureView, setInfrastructureView] = useState<"gateways" | "sources">("gateways");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [deviceUserId, setDeviceUserId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [deviceFingerprint, setDeviceFingerprint] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [gatewayName, setGatewayName] = useState("");
  const [gatewayEndpoint, setGatewayEndpoint] = useState("");
  const [gatewayCertificateFingerprint, setGatewayCertificateFingerprint] =
    useState("");
  const [gatewayEnrollmentPublicKey, setGatewayEnrollmentPublicKey] =
    useState("");
  const [gatewayEnrollment, setGatewayEnrollment] =
    useState<GatewayRegistration | null>(null);
  const [gatewayRotation, setGatewayRotation] =
    useState<GatewayCertificateRotation | null>(null);
  const [gatewayRotationTarget, setGatewayRotationTarget] = useState<string | null>(null);
  const [gatewayRotationFingerprint, setGatewayRotationFingerprint] = useState("");
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceGatewayId, setSourceGatewayId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceDriver, setSourceDriver] = useState("postgres");
  const [sourceTargetBinding, setSourceTargetBinding] = useState("");
  const [renewSourceId, setRenewSourceId] = useState("");
  const [renewTargetBinding, setRenewTargetBinding] = useState("");
  const [assignmentProjectId, setAssignmentProjectId] = useState("");
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [grantProjectId, setGrantProjectId] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantDataSourceId, setGrantDataSourceId] = useState("");
  const [grantPath, setGrantPath] = useState("");
  const [grantEffect, setGrantEffect] = useState<"permit" | "forbid">("permit");
  const [grantActions, setGrantActions] = useState<string[]>([
    "resourceDiscover",
    "metadataRead",
    "queryRead",
  ]);
  const [ticketNonce, setTicketNonce] = useState("");
  const [ticketRevocationReason, setTicketRevocationReason] = useState("");
  const [signedIn, setSignedIn] = useState(Boolean(adminAuth.accessToken()));
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const t = (key: string, variables?: Record<string, string | number>) =>
    translate(locale, key, variables);

  const refresh = async () => {
    if (!organizationId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setOverview(await adminApi.overview(organizationId));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void adminAuth
      .completeCallback()
      .then((completed) => {
        if (completed) setSignedIn(true);
        if (completed || adminAuth.accessToken()) void refresh();
      })
      .catch((callbackError) => {
        setError(
          callbackError instanceof Error
            ? callbackError.message
            : String(callbackError),
        );
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    saveAdminLocale(locale);
  }, [locale]);

  useEffect(() => {
    const handleHashChange = () => setActiveSection(sectionFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const sendInvitation = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.invite(organizationId, email, role);
      setInviteOpen(false);
      setEmail("");
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.createProject(organizationId, projectName);
      setProjectName("");
      setProjectOpen(false);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const setMinimumDesktopVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("minimumDesktopVersion");
    if (typeof value !== "string") return;
    setLoading(true);
    setError(null);
    try {
      await adminApi.setMinimumDesktopVersion(organizationId, value);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const refreshAuditEvents = async () => {
    if (!organizationId) return;
    setAuditLoading(true);
    setError(null);
    try {
      const result = await adminApi.auditEvents(organizationId);
      setAuditEvents(result.events);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === "audit" && signedIn && organizationId) {
      void refreshAuditEvents();
    }
  }, [activeSection, signedIn]);

  const registerManagedDevice = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.registerManagedDevice(organizationId, {
        userId: deviceUserId,
        deviceId,
        certificateFingerprint: deviceFingerprint,
        displayName: deviceName || undefined,
      });
      setDeviceOpen(false);
      setDeviceUserId("");
      setDeviceId("");
      setDeviceFingerprint("");
      setDeviceName("");
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const revokeManagedDevice = async (userId: string, deviceId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.revokeManagedDevice(organizationId, { userId, deviceId });
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const suspendMember = async (memberId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.suspendMember(organizationId, memberId);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const activateMember = async (memberId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.activateMember(organizationId, memberId);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const transferOrganizationOwnership = async (
    memberId: string,
    displayName: string,
  ) => {
    if (
      !window.confirm(
        t("Transfer organization ownership to {name}? Your owner role will become administrator.", { name: displayName }),
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await adminApi.transferOrganizationOwnership(organizationId, memberId);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const revokeGateway = async (gatewayId: string) => {
    setLoading(true);
    setError(null);
    try {
      await adminApi.revokeGateway(organizationId, gatewayId);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const revokeAccessTicket = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.revokeAccessTicket(organizationId, {
        nonce: ticketNonce,
        reason: ticketRevocationReason,
      });
      setTicketNonce("");
      setTicketRevocationReason("");
      setLoading(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const registerGateway = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const registration = await adminApi.registerGateway(
        organizationId,
        gatewayName,
        gatewayEndpoint,
        gatewayCertificateFingerprint,
        gatewayEnrollmentPublicKey,
      );
      setGatewayName("");
      setGatewayEndpoint("");
      setGatewayCertificateFingerprint("");
      setGatewayEnrollmentPublicKey("");
      setGatewayOpen(false);
      setGatewayEnrollment(registration);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const rotateGatewayCertificate = async (event: FormEvent) => {
    event.preventDefault();
    const gatewayId = gatewayRotationTarget;
    if (!gatewayId) return;
    setLoading(true);
    setError(null);
    try {
      const rotation = await adminApi.rotateGatewayCertificate(
        organizationId,
        gatewayId,
        gatewayRotationFingerprint,
      );
      setGatewayRotation(rotation);
      setGatewayRotationTarget(null);
      setGatewayRotationFingerprint("");
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const registerDataSource = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.registerDataSource(organizationId, {
        projectId: sourceProjectId,
        gatewayId: sourceGatewayId,
        driver: sourceDriver,
        targetBinding: sourceTargetBinding,
        displayName: sourceName,
        capabilities: [
          "resourceDiscover",
          "metadataRead",
          "queryRead",
        ],
      });
      setSourceName("");
      setSourceTargetBinding("");
      setSourceOpen(false);
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const renewDataSourceTargetBinding = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.renewDataSourceTargetBinding(organizationId, renewSourceId, renewTargetBinding);
      setRenewSourceId("");
      setRenewTargetBinding("");
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setLoading(false);
    }
  };

  const assignProject = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.assignProject(
        organizationId,
        assignmentProjectId,
        assignmentUserId,
      );
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const createGrant = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.createGrant(organizationId, {
        projectId: grantProjectId,
        principalId: grantUserId,
        dataSourceId: grantDataSourceId || undefined,
        resourcePath: grantPath
          .split("/")
          .map((segment) => segment.trim())
          .filter(Boolean),
        actions: grantActions,
        effect: grantEffect,
      });
      await refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const organization = await adminApi.createOrganization(
        organizationSlug,
        organizationName,
      );
      sessionStorage.setItem(
        "oxide.enterprise.admin.organization",
        organization.id,
      );
      window.location.assign(
        `${window.location.pathname}?organization=${encodeURIComponent(organization.id)}`,
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
      setLoading(false);
    }
  };

  const grantProject = overview?.projects.find(
    (project) => project.id === grantProjectId,
  );

  const navigationItems: Array<{
    id: AdminSection;
    label: string;
    icon: typeof ShieldCheck;
  }> = [
    { id: "overview", label: "Overview", icon: ShieldCheck },
    { id: "members", label: "Members", icon: Users },
    { id: "projects", label: "Projects", icon: FolderKanban },
    { id: "infrastructure", label: "Infrastructure", icon: ServerCog },
    { id: "policies", label: "Access policies", icon: KeyRound },
    { id: "audit", label: "Audit", icon: ScrollText },
  ];

  const activeGateways = overview?.gateways.filter(
    (gateway) => gateway.status === "active",
  ).length ?? 0;

  return (
    <div className={`admin-shell ${organizationId && signedIn ? "is-ready" : "is-onboarding"}`}>
      {organizationId && signedIn && (
        <aside className="navigation">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>OxideStudio Admin</span>
          </div>
          <div className="organization-switcher">
            <span className="organization-avatar">
              {(overview?.organization.displayName || "O").slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{overview?.organization.displayName || t("Organization")}</strong>
              <small>{overview?.viewerRole ? t(overview.viewerRole) : t("Loading access")}</small>
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
      )}

      <main>
        <header className="context-bar">
          <div className="context-identity">
            {!organizationId && <span className="brand-mark" aria-hidden="true" />}
            <strong>{organizationId && signedIn ? overview?.organization.displayName || t("Organization") : "OxideStudio Admin"}</strong>
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
                <span className="environment-status"><i /> {t("Production")}</span>
                <span className="gateway-health">
                  <Activity size={14} /> {t(activeGateways === 1 ? "{count} gateway healthy" : "{count} gateways healthy", { count: activeGateways })}
                </span>
                <button className="icon-button" onClick={() => void refresh()} aria-label={t("Synchronize organization")}>
                  <RefreshCw size={15} className={loading ? "spin" : ""} />
                </button>
              </>
            )}
            {!organizationId && signedIn && (
              <span className="casdoor-status"><i /> {t("Casdoor connected")}</span>
            )}
            <label className="language-control">
              <Languages size={14} aria-hidden="true" />
              <span className="sr-only">{t("Language")}</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value as AdminLocale)} aria-label={t("Language")}>
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
            {!signedIn && (
              <button className="primary-button" onClick={() => void adminAuth.signIn()}>
                <LogIn size={14} /> {t("Sign in")}
              </button>
            )}
          </div>
        </header>

        {error && <div className="error-line" role="alert">{t(error)}</div>}
        {!signedIn ? (
          <section className="signin-workspace">
            <div className="signin-panel">
              <ShieldCheck size={26} />
              <p className="section-kicker">{t("Identity required")}</p>
              <h1>{t("Sign in to administer OxideStudio")}</h1>
              <p>{t("Authenticate with Casdoor before organization settings and management modules become available.")}</p>
              <button className="primary-button" onClick={() => void adminAuth.signIn()}>
                <LogIn size={14} /> {t("Sign in with Casdoor")}
              </button>
            </div>
          </section>
        ) : !organizationId ? (
          <section className="onboarding-workspace">
            <div className="setup-introduction">
              <p className="section-kicker">{t("First-time setup")}</p>
              <h1>{t("Set up your control plane")}</h1>
              <p className="setup-copy">
                {t("Initialize the organization before administrative modules become available.")}
              </p>
              <ol className="setup-steps">
                <li className={signedIn ? "complete" : "current"}>
                  <span>{signedIn ? <Check size={16} /> : "1"}</span>
                  <div><strong>{t("Connect identity provider")}</strong><small>{t("Authenticate administrators through Casdoor.")}</small></div>
                </li>
                <li className={signedIn ? "current" : ""}>
                  <span>2</span>
                  <div><strong>{t("Create organization")}</strong><small>{t("Establish the access and resource boundary.")}</small></div>
                </li>
                <li>
                  <span>3</span>
                  <div><strong>{t("Invite administrators")}</strong><small>{t("Add operators after initialization succeeds.")}</small></div>
                </li>
              </ol>
            </div>
            <div className="setup-form-panel">
              {signedIn ? (
                <>
                  <div className="identity-check">
                    <span><Users size={16} /> {t("Signed in as administrator")}</span>
                    <span className="casdoor-status"><i /> {t("Connected")}</span>
                  </div>
                  <SectionHeading
                    title={t("Create organization")}
                    detail={t("The signed-in identity becomes the first organization owner.")}
                  />
                  <form className="setup-form" onSubmit={createOrganization}>
                    <label>
                      {t("Organization name")}
                      <input required maxLength={128} placeholder="Acme Engineering" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} />
                    </label>
                    <label>
                      {t("Organization slug")}
                      <input required minLength={2} maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="acme-engineering" value={organizationSlug} onChange={(event) => setOrganizationSlug(event.target.value.toLowerCase())} />
                      <small>{t("Used in URLs and identifiers. Choose a stable value.")}</small>
                    </label>
                    <div className="form-actions">
                      <button className="primary-button" disabled={loading}>{t("Create organization")}</button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="signin-panel">
                  <ShieldCheck size={24} />
                  <h2>{t("Connect Casdoor")}</h2>
                  <p>{t("Sign in with the configured identity provider to initialize this control plane.")}</p>
                  <button className="primary-button" onClick={() => void adminAuth.signIn()}>
                    <LogIn size={14} /> {t("Sign in to continue")}
                  </button>
                </div>
              )}
            </div>
          </section>
        ) : !overview && loading ? (
          <div className="loading">
            <LoaderCircle size={16} className="spin" /> {t("Loading organization…")}
          </div>
        ) : (
          <>
            <section className="module-pane" hidden={activeSection !== "overview"} aria-label={t("Overview")}>
              <SectionHeading
                title={t("Organization overview")}
                detail={t("Operational readiness and the boundaries that currently control managed access.")}
                action={
                  <button className="quiet-button" onClick={() => void refresh()}>
                    <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
                  </button>
                }
              />
              <div className="overview-workspace">
                <div className="overview-primary">
                  <h3>{t("Control plane status")}</h3>
                  <div className="status-row"><span><Users size={16} /> {t("Members")}</span><strong>{overview?.members.length ?? 0}</strong><a href="#members">{t("Manage")}</a></div>
                  <div className="status-row"><span><FolderKanban size={16} /> {t("Projects")}</span><strong>{overview?.projects.length ?? 0}</strong><a href="#projects">{t("Manage")}</a></div>
                  <div className="status-row"><span><Database size={16} /> {t("Data sources")}</span><strong>{overview?.projects.reduce((total, project) => total + project.dataSourceCount, 0) ?? 0}</strong><a href="#infrastructure">{t("Manage")}</a></div>
                  <div className="status-row"><span><Network size={16} /> {t("Active gateways")}</span><strong>{activeGateways}</strong><a href="#infrastructure">{t("Manage")}</a></div>
                </div>
                <aside className="readiness-panel">
                  <span className="readiness-label">{t("Environment")}</span>
                  <strong><i /> {t("Production")}</strong>
                  <p>{t("Identity, projects and gateway boundaries are enforced by the control plane.")}</p>
                  <dl>
                    <div><dt>{t("Your role")}</dt><dd>{overview?.viewerRole ? t(overview.viewerRole) : ""}</dd></div>
                    <div><dt>{t("Desktop minimum")}</dt><dd>{overview?.organization.minimumDesktopVersion}</dd></div>
                    <div><dt>{t("Organization ID")}</dt><dd><code>{overview?.organization.id}</code></dd></div>
                  </dl>
                </aside>
              </div>
            </section>

            <section className="module-pane" hidden={activeSection !== "projects"}>
              <SectionHeading
                title={t("Managed projects")}
                detail={t("Project assignments determine what members can discover.")}
                action={
                  <button
                    className="primary-button"
                    onClick={() => setProjectOpen((value) => !value)}
                  >
                    <Plus size={14} /> {t("New project")}
                  </button>
                }
              />
              {projectOpen && (
                <form className="inline-form" onSubmit={createProject}>
                  <label>
                    {t("Project name")}
                    <input
                      required
                      maxLength={128}
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    {t("Create project")}
                  </button>
                </form>
              )}
              <div className="table">
                <div className="table-row table-head">
                  <span>{t("Project")}</span>
                  <span>{t("Data sources")}</span>
                  <span>{t("Members")}</span>
                  <span>{t("Policy revision")}</span>
                </div>
                {overview?.projects.map((project) => (
                  <div className="table-row" key={project.id}>
                    <strong>{project.displayName}</strong>
                    <span>{project.dataSourceCount}</span>
                    <span>{project.memberCount}</span>
                    <code>{project.policyRevision}</code>
                  </div>
                ))}
                {overview?.projects.length === 0 && (
                  <div className="empty">{t("No managed projects assigned.")}</div>
                )}
              </div>
              <form className="inline-form" onSubmit={assignProject}>
                <label>
                  {t("Project")}
                  <select
                    required
                    value={assignmentProjectId}
                    onChange={(event) =>
                      setAssignmentProjectId(event.target.value)
                    }
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
                    value={assignmentUserId}
                    onChange={(event) =>
                      setAssignmentUserId(event.target.value)
                    }
                  >
                    <option value="">{t("Select member")}</option>
                    {overview?.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" disabled={loading}>
                  {t("Assign project")}
                </button>
              </form>
            </section>

            <section className="module-pane" hidden={activeSection !== "members"}>
              <SectionHeading
                title={t("Members")}
                detail={t("Personal identities keep their local projects when enterprise access changes.")}
                action={
                  <div className="header-actions">
                    <button
                      className="quiet-button"
                      onClick={() => setDeviceOpen((value) => !value)}
                    >
                      <KeyRound size={14} /> {t("Enroll device")}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => setInviteOpen((value) => !value)}
                    >
                      <Plus size={14} /> {t("Invite member")}
                    </button>
                  </div>
                }
              />
              {inviteOpen && (
                <form className="inline-form" onSubmit={sendInvitation}>
                  <label>
                    {t("Verified email")}
                    <input
                      type="email"
                      value={email}
                      required
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    {t("Organization role")}
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      <option value="member">{t("Member")}</option>
                      <option value="administrator">{t("Administrator")}</option>
                    </select>
                  </label>
                  <button className="primary-button" disabled={loading}>
                    {t("Send invitation")}
                  </button>
                </form>
              )}
              {deviceOpen && (
                <form
                  className="inline-form device-enrollment-form"
                  onSubmit={registerManagedDevice}
                >
                  <label>
                    {t("Member")}
                    <select
                      required
                      value={deviceUserId}
                      onChange={(event) => setDeviceUserId(event.target.value)}
                    >
                      <option value="">{t("Select member")}</option>
                      {overview?.members
                        .filter((member) => member.status === "active")
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t("Device UUID")}
                    <input
                      required
                      value={deviceId}
                      placeholder={t("Desktop enrollment ID")}
                      onChange={(event) => setDeviceId(event.target.value)}
                    />
                  </label>
                  <label>
                    {t("Client certificate SHA-256")}
                    <input
                      required
                      minLength={64}
                      maxLength={64}
                      pattern="[A-Fa-f0-9]{64}"
                      value={deviceFingerprint}
                      onChange={(event) =>
                        setDeviceFingerprint(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {t("Device name")}
                    <input
                      maxLength={128}
                      value={deviceName}
                      placeholder={t("Optional")}
                      onChange={(event) => setDeviceName(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    {t("Enroll device")}
                  </button>
                </form>
              )}
              <div className="table">
                <div className="table-row member-row table-head">
                  <span>{t("Member")}</span>
                  <span>{t("Role")}</span>
                  <span>{t("Status")}</span>
                  <span aria-label={t("Actions")} />
                </div>
                {overview?.members.map((member) => (
                  <div className="table-row member-row" key={member.id}>
                    <span>
                      <strong>{member.displayName}</strong>
                      <small>{member.email}</small>
                    </span>
                    <span>{t(member.role)}</span>
                    <span className={`status ${member.status}`}>
                      {t(member.status)}
                    </span>
                    <span className="member-actions">
                      {overview?.viewerRole === "owner" &&
                        member.status === "active" &&
                        member.role !== "owner" && (
                        <button
                          type="button"
                          className="quiet-button"
                          disabled={loading}
                          onClick={() =>
                            void transferOrganizationOwnership(
                              member.id,
                              member.displayName,
                            )
                          }
                        >
                          {t("Make owner")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="quiet-button danger-button"
                        disabled={
                          loading ||
                          member.status === "invited" ||
                          (member.status === "active" && member.role === "owner")
                        }
                        title={
                          member.role === "owner"
                            ? t("Transfer ownership before suspending an owner.")
                            : member.status === "invited"
                              ? t("An invited member must complete sign-in before it can be managed.")
                              : undefined
                        }
                        onClick={() =>
                          void (member.status === "active"
                            ? suspendMember(member.id)
                            : activateMember(member.id))
                        }
                      >
                        {member.status === "active" ? t("Suspend") : t("Reactivate")}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="device-heading">
                <strong>{t("Managed devices")}</strong>
                <span>
                  {t("Revoke stops new tickets immediately; an already issued ticket remains bounded by its 60-second lifetime.")}
                </span>
              </div>
              <div className="table device-table">
                <div className="table-row device-row table-head">
                  <span>{t("Device")}</span>
                  <span>{t("Owner")}</span>
                  <span>{t("Certificate")}</span>
                  <span>{t("Status")}</span>
                  <span aria-label={t("Actions")} />
                </div>
                {overview?.managedDevices.map((device) => (
                  <div
                    className="table-row device-row"
                    key={`${device.userId}-${device.deviceId}`}
                  >
                    <span>
                      <strong>{device.displayName || t("Managed device")}</strong>
                      <small>{device.deviceId}</small>
                    </span>
                    <span>{device.userDisplayName}</span>
                    <code title={device.certificateFingerprint}>
                      {device.certificateFingerprint.slice(0, 16)}…
                    </code>
                    <span className={`status ${device.status}`}>
                      {t(device.status)}
                    </span>
                    <button
                      type="button"
                      className="quiet-button danger-button"
                      disabled={loading || device.status !== "active"}
                      onClick={() =>
                        void revokeManagedDevice(device.userId, device.deviceId)
                      }
                    >
                      {t("Revoke")}
                    </button>
                  </div>
                ))}
                {overview?.managedDevices.length === 0 && (
                  <div className="empty">
                    {t("No managed devices have been enrolled.")}
                  </div>
                )}
              </div>
            </section>

            <section className="module-pane organization-baseline" hidden={activeSection !== "overview"}>
              <SectionHeading
                title={t("Desktop compatibility")}
                detail={t("Older desktop builds cannot receive new managed access tickets after this version takes effect.")}
              />
              <form className="inline-form" onSubmit={setMinimumDesktopVersion}>
                <label>
                  {t("Minimum desktop version")}
                  <input
                    key={overview?.organization.minimumDesktopVersion}
                    name="minimumDesktopVersion"
                    required
                    pattern="[0-9]+\\.[0-9]+\\.[0-9]+"
                    defaultValue={overview?.organization.minimumDesktopVersion || "0.0.0"}
                    title={t("Stable semantic version, for example 0.1.13")}
                  />
                </label>
                <button className="primary-button" disabled={loading}>
                  {t("Enforce version")}
                </button>
              </form>
            </section>

            <section className="module-pane" hidden={activeSection !== "infrastructure"}>
              <SectionHeading
                title={t("Infrastructure")}
                detail={t("Manage gateway connectivity and the credential-free data sources bound to it.")}
                action={
                  infrastructureView === "gateways" ? (
                    <button className="primary-button" onClick={() => setGatewayOpen((value) => !value)}>
                      <Plus size={14} /> {t("Register Gateway")}
                    </button>
                  ) : (
                    <button className="primary-button" onClick={() => setSourceOpen((value) => !value)}>
                      <Plus size={14} /> {t("Add data source")}
                    </button>
                  )
                }
              />
              <div className="section-tabs" role="tablist" aria-label={t("Infrastructure resources")}>
                <button className={infrastructureView === "gateways" ? "active" : ""} onClick={() => setInfrastructureView("gateways")} role="tab" aria-selected={infrastructureView === "gateways"}>{t("Gateways")} <span>{overview?.gateways.length ?? 0}</span></button>
                <button className={infrastructureView === "sources" ? "active" : ""} onClick={() => setInfrastructureView("sources")} role="tab" aria-selected={infrastructureView === "sources"}>{t("Data sources")} <span>{overview?.projects.reduce((total, project) => total + project.dataSourceCount, 0) ?? 0}</span></button>
              </div>
              {infrastructureView === "gateways" && (
              <div className="resource-workspace">
              {gatewayOpen && (
                <form
                  className="inline-form gateway-registration-form"
                  onSubmit={registerGateway}
                >
                  <label>
                    {t("Display name")}
                    <input
                      required
                      maxLength={128}
                      value={gatewayName}
                      onChange={(event) => setGatewayName(event.target.value)}
                    />
                  </label>
                  <label>
                    {t("Direct mTLS endpoint")}
                    <input
                      required
                      type="url"
                      placeholder="https://gateway.example.com:8790"
                      value={gatewayEndpoint}
                      onChange={(event) =>
                        setGatewayEndpoint(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {t("TLS certificate SHA-256")}
                    <input
                      required
                      minLength={64}
                      maxLength={64}
                      pattern="[A-Fa-f0-9]{64}"
                      placeholder={t("64 hexadecimal characters")}
                      value={gatewayCertificateFingerprint}
                      onChange={(event) =>
                        setGatewayCertificateFingerprint(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    {t("Enrollment public key (Ed25519)")}
                    <input
                      required
                      minLength={44}
                      maxLength={44}
                      placeholder={t("base64-encoded 32-byte public key")}
                      value={gatewayEnrollmentPublicKey}
                      onChange={(event) =>
                        setGatewayEnrollmentPublicKey(event.target.value)
                      }
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    {t("Register Gateway")}
                  </button>
                </form>
              )}
              {gatewayEnrollment && (
                <div className="enrollment-instructions" role="status">
                  <div>
                    <strong>{t("Save this one-time enrollment token now.")}</strong>
                    <p>
                      {t("The control plane stores only a digest. The Gateway must present this token with the registered TLS certificate before it can become active. It expires at {time}.", {
                        time: new Date(gatewayEnrollment.enrollment.expiresAt).toLocaleString(locale),
                      })}
                    </p>
                  </div>
                  <label>
                    {t("Enrollment token")}
                    <textarea
                      readOnly
                      value={gatewayEnrollment.enrollment.token}
                      aria-label={t("One-time Gateway enrollment token")}
                    />
                  </label>
                  <code className="enrollment-config">
                    OXIDE_GATEWAY_ID={gatewayEnrollment.id}{"\n"}
                    OXIDE_GATEWAY_PUBLIC_ENDPOINT={gatewayEnrollment.directEndpoint}{"\n"}
                    OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE=/run/secrets/oxide-gateway-enrollment
                    {"\n"}
                    OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE=/run/secrets/oxide-gateway-enrollment-key
                  </code>
                  <p className="enrollment-note">
                    {t("Write both the token and its matching Ed25519 private key to private files (mode 0600 on Unix), then start the Gateway. Do not add either to source control, shell history, or a shared configuration file.")}
                  </p>
                </div>
              )}
              {gatewayRotationTarget && (
                <form className="inline-form gateway-rotation-form" onSubmit={rotateGatewayCertificate}>
                  <label>
                    {t("Replacement TLS certificate SHA-256")}
                    <input
                      required
                      minLength={64}
                      maxLength={64}
                      pattern="[A-Fa-f0-9]{64}"
                      placeholder={t("64 hexadecimal characters")}
                      value={gatewayRotationFingerprint}
                      onChange={(event) => setGatewayRotationFingerprint(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    {t("Create rotation token")}
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={loading}
                    onClick={() => {
                      setGatewayRotationTarget(null);
                      setGatewayRotationFingerprint("");
                    }}
                  >
                    {t("Cancel")}
                  </button>
                </form>
              )}
              {gatewayRotation && (
                <div className="enrollment-instructions" role="status">
                  <div>
                    <strong>{t("Save this one-time certificate rotation token now.")}</strong>
                    <p>
                      {t("Deploy the replacement TLS certificate, keep the existing Gateway signing-key file, and restart before {time}.", {
                        time: new Date(gatewayRotation.enrollment.expiresAt).toLocaleString(locale),
                      })}
                    </p>
                  </div>
                  <label>
                    {t("Certificate rotation token")}
                    <textarea
                      readOnly
                      value={gatewayRotation.enrollment.token}
                      aria-label={t("One-time Gateway certificate rotation token")}
                    />
                  </label>
                  <code className="enrollment-config">
                    OXIDE_GATEWAY_ID={gatewayRotation.id}{"\n"}
                    OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE=/run/secrets/oxide-gateway-certificate-rotation{"\n"}
                    OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE=/run/secrets/oxide-gateway-enrollment-key
                  </code>
                  <p className="enrollment-note">
                    {t("The control plane never receives the private key. Remove the token file after the new Gateway instance is active.")}
                  </p>
                </div>
              )}
              <div className="gateway-list">
                {overview?.gateways.map((gateway) => (
                  <div className="gateway-line" key={gateway.id}>
                    <Building2 size={15} />
                    <span>
                      <strong>{gateway.displayName}</strong>
                      <small>{gateway.id}</small>
                    </span>
                    <span className={`status ${gateway.status}`}>
                      {t(gateway.status)}
                    </span>
                    <button
                      type="button"
                      className="quiet-button"
                      disabled={loading || gateway.status !== "active"}
                      onClick={() => {
                        setGatewayRotationTarget(gateway.id);
                        setGatewayRotation(null);
                        setGatewayRotationFingerprint("");
                      }}
                    >
                      {t("Rotate cert")}
                    </button>
                    <button
                      type="button"
                      className="quiet-button danger-button"
                      disabled={
                        loading ||
                        !["pending", "active"].includes(gateway.status)
                      }
                      onClick={() => void revokeGateway(gateway.id)}
                    >
                      {t("Revoke")}
                    </button>
                  </div>
                ))}
              </div>
              </div>
              )}
              {infrastructureView === "sources" && (
                <div className="resource-workspace">
                  {sourceOpen && (
                    <form className="inline-form source-registration-form" onSubmit={registerDataSource}>
                      <label>
                        {t("Project")}
                        <select required value={sourceProjectId} onChange={(event) => setSourceProjectId(event.target.value)}>
                          <option value="">{t("Select project")}</option>
                          {overview?.projects.map((project) => <option key={project.id} value={project.id}>{project.displayName}</option>)}
                        </select>
                      </label>
                      <label>
                        {t("Gateway")}
                        <select required value={sourceGatewayId} onChange={(event) => setSourceGatewayId(event.target.value)}>
                          <option value="">{t("Select Gateway")}</option>
                          {overview?.gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.displayName}</option>)}
                        </select>
                      </label>
                      <label>
                        {t("Display name")}
                        <input required maxLength={128} value={sourceName} onChange={(event) => setSourceName(event.target.value)} />
                      </label>
                      <label>
                        {t("Driver")}
                        <select value={sourceDriver} onChange={(event) => setSourceDriver(event.target.value)}>
                          <option value="postgres">PostgreSQL</option>
                          <option value="mysql">MySQL</option>
                          <option value="mongodb">MongoDB</option>
                          <option value="elasticsearch">Elasticsearch</option>
                          <option value="redis">Redis</option>
                        </select>
                      </label>
                      <label className="source-target-binding">
                        {t("Target binding")}
                        <input required inputMode="text" autoComplete="off" spellCheck={false} maxLength={64} pattern="[a-fA-F0-9]{64}" placeholder={t("Gateway-generated SHA-256 fingerprint")} value={sourceTargetBinding} onChange={(event) => setSourceTargetBinding(event.target.value)} />
                      </label>
                      <p className="inline-form-hint source-binding-hint">{t("Paste the credential-free fingerprint generated beside the Gateway. No connection URL or secret is sent here.")}</p>
                      <button className="primary-button" disabled={loading}>{t("Register data source")}</button>
                    </form>
                  )}
                  <div className="table source-table">
                    <div className="table-row table-head"><span>{t("Data source")}</span><span>{t("Driver")}</span><span>{t("Project")}</span><span>{t("Gateway")}</span><span>{t("Capabilities")}</span><span>{t("Binding")}</span></div>
                    {overview?.projects.flatMap((project) => project.dataSources.map((source) => {
                      const profile = driverProfiles[source.driver] ?? { label: source.driver, model: "Database connection" };
                      return (
                        <div className="table-row" key={source.id}>
                          <span><strong>{source.displayName}</strong><small>{source.allowedResourceSummary.join(" · ") || source.id}</small></span>
                          <span><strong>{profile.label}</strong><small>{t(profile.model)}</small></span>
                          <span>{project.displayName}</span>
                          <span><strong>{source.gatewayName}</strong><small className={`connection-state ${source.gatewayStatus}`}>{t(source.gatewayStatus)}</small></span>
                          <code>{source.capabilities.map((capability) => t(accessActions.find(([value]) => value === capability)?.[1] ?? capability)).join(" · ")}</code>
                          <code title={source.targetBinding}>{source.targetBinding ? `${source.targetBinding.slice(0, 12)}…` : t("Not bound")}</code>
                        </div>
                      );
                    }))}
                    {overview?.projects.every((project) => project.dataSources.length === 0) && <div className="empty">{t("No data sources registered.")}</div>}
                  </div>
                  <form className="inline-form renew-binding-form" onSubmit={renewDataSourceTargetBinding}>
                    <label>
                      {t("Renew source binding")}
                      <select required value={renewSourceId} onChange={(event) => setRenewSourceId(event.target.value)}>
                        <option value="">{t("Select data source")}</option>
                        {overview?.projects.flatMap((project) => project.dataSources).map((source) => <option key={source.id} value={source.id}>{source.displayName} · {source.driver}</option>)}
                      </select>
                    </label>
                    <label className="source-target-binding">
                      {t("New target binding")}
                      <input required maxLength={64} pattern="[a-fA-F0-9]{64}" autoComplete="off" spellCheck={false} value={renewTargetBinding} onChange={(event) => setRenewTargetBinding(event.target.value)} />
                    </label>
                    <button className="quiet-button" disabled={loading}>{t("Renew binding")}</button>
                    <p className="inline-form-hint source-binding-hint">{t("Update this only after changing the Gateway-local source. Existing grants and the data source ID stay intact.")}</p>
                  </form>
                </div>
              )}
            </section>

            <section className="module-pane" hidden={activeSection !== "policies"}>
              <SectionHeading
                title={t("Access policies")}
                detail={t("Permissions are explicit, resource-scoped and deny by default. A forbid rule always wins.")}
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
                      onChange={(event) =>
                        setGrantDataSourceId(event.target.value)
                      }
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
                        setGrantEffect(
                          event.target.value as "permit" | "forbid",
                        )
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
                    placeholder={t("database/schema/table — blank means the whole data source")}
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

            <section className="module-pane" hidden={activeSection !== "audit"}>
              <SectionHeading
                title={t("Security audit")}
                detail={t("Review control-plane decisions and revoke a specific managed access ticket when necessary.")}
                action={
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={auditLoading}
                    onClick={() => void refreshAuditEvents()}
                  >
                    <RefreshCw size={14} className={auditLoading ? "spin" : undefined} />
                    {t("Refresh events")}
                  </button>
                }
              />
              <form
                className="inline-form ticket-revocation-form danger-zone"
                onSubmit={revokeAccessTicket}
              >
                <label>
                  {t("Ticket nonce")}
                  <input
                    required
                    pattern="[0-9a-fA-F-]{36}"
                    placeholder={t("UUID from the access-ticket audit event")}
                    value={ticketNonce}
                    onChange={(event) => setTicketNonce(event.target.value)}
                  />
                </label>
                <label>
                  {t("Reason")}
                  <input
                    required
                    maxLength={256}
                    placeholder={t("Why this specific ticket is no longer valid")}
                    value={ticketRevocationReason}
                    onChange={(event) =>
                      setTicketRevocationReason(event.target.value)
                    }
                  />
                </label>
                <button className="primary-button" disabled={loading}>
                  {t("Revoke ticket")}
                </button>
              </form>
              <div className="audit-list" aria-label={t("Recent security audit events")}>
                <div className="audit-line audit-head"><span>{t("Event")}</span><span>{t("Request / ticket")}</span><span>{t("Action")}</span></div>
                {auditEvents.map((event) => {
                  const nonce = typeof event.metadata.ticketNonce === "string" ? event.metadata.ticketNonce : null;
                  return (
                      <div className="audit-line" key={event.requestId}>
                        <span>
                          <strong>{event.action}</strong>
                          <small>
                            {new Date(event.occurredAt).toLocaleString(locale)} · {event.reasonCode}
                          </small>
                        </span>
                        <code>{nonce || event.requestId}</code>
                        {nonce ? (
                          <button type="button" className="quiet-button" onClick={() => setTicketNonce(nonce)}>{t("Use nonce")}</button>
                        ) : <span className={`status ${event.decision === "permit" ? "active" : "revoked"}`}>{t(event.decision)}</span>}
                      </div>
                  );
                })}
                {!auditLoading && auditEvents.length === 0 && <div className="empty">{t("No audit events returned.")}</div>}
                {auditLoading && <div className="loading"><LoaderCircle size={15} className="spin" /> {t("Loading events…")}</div>}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function SectionHeading({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {action}
    </div>
  );
}
