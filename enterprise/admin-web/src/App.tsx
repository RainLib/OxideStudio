import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Building2,
  Database,
  KeyRound,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  LogIn,
  LogOut,
  Users,
} from "lucide-react";
import {
  adminApi,
  type AdminOverview,
  type GatewayRegistration,
} from "./api";
import { adminAuth } from "./auth";

const organizationId = adminAuth.organizationId();
const accessActions = [
  ["resourceDiscover", "Discover"],
  ["metadataRead", "Metadata"],
  ["queryRead", "Read query"],
] as const;

export function App() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
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
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [sourceGatewayId, setSourceGatewayId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceDriver, setSourceDriver] = useState("postgres");
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
  const [signedIn, setSignedIn] = useState(Boolean(adminAuth.accessToken()));
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");

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

  const registerDataSource = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.registerDataSource(organizationId, {
        projectId: sourceProjectId,
        gatewayId: sourceGatewayId,
        driver: sourceDriver,
        displayName: sourceName,
        capabilities: [
          "resourceDiscover",
          "metadataRead",
          ...(sourceDriver === "postgres" ||
          sourceDriver === "postgresql" ||
          sourceDriver === "mysql"
            ? ["queryRead"]
            : []),
        ],
      });
      setSourceName("");
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

  return (
    <div className="admin-shell">
      <aside className="navigation">
        <div className="brand">
          <span className="brand-mark">O</span>
          <span>Oxide Enterprise</span>
        </div>
        <nav aria-label="Enterprise administration">
          <a className="nav-item active" href="#overview">
            <ShieldCheck size={15} /> Overview
          </a>
          <a className="nav-item" href="#members">
            <Users size={15} /> Members
          </a>
          <a className="nav-item" href="#projects">
            <Database size={15} /> Managed projects
          </a>
          <a className="nav-item" href="#gateways">
            <Network size={15} /> Gateways
          </a>
          <a className="nav-item" href="#policies">
            <KeyRound size={15} /> Access policies
          </a>
        </nav>
      </aside>

      <main>
        <header>
          <div>
            <div className="eyebrow">Organization</div>
            <h1>{overview?.organization.displayName || "Enterprise access"}</h1>
          </div>
          <div className="header-actions">
            {signedIn ? (
              <>
                <button className="quiet-button" onClick={() => void refresh()}>
                  <RefreshCw size={14} className={loading ? "spin" : ""} />
                  Synchronize
                </button>
                <button className="quiet-button" onClick={adminAuth.signOut}>
                  <LogOut size={14} />
                  Sign out
                </button>
              </>
            ) : (
              <button
                className="primary-button"
                onClick={() => void adminAuth.signIn()}
              >
                <LogIn size={14} />
                Sign in
              </button>
            )}
          </div>
        </header>

        {error && <div className="error-line">{error}</div>}
        {!organizationId ? (
          <section>
            <SectionHeading
              title="Create an organization"
              detail="Your personal identity becomes the first organization owner. Local desktop projects remain separate."
            />
            {signedIn ? (
              <form className="inline-form" onSubmit={createOrganization}>
                <label>
                  Organization name
                  <input
                    required
                    maxLength={128}
                    value={organizationName}
                    onChange={(event) =>
                      setOrganizationName(event.target.value)
                    }
                  />
                </label>
                <label>
                  URL slug
                  <input
                    required
                    minLength={2}
                    maxLength={64}
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    value={organizationSlug}
                    onChange={(event) =>
                      setOrganizationSlug(event.target.value.toLowerCase())
                    }
                  />
                </label>
                <button className="primary-button" disabled={loading}>
                  Create organization
                </button>
              </form>
            ) : (
              <button
                className="primary-button"
                onClick={() => void adminAuth.signIn()}
              >
                <LogIn size={14} /> Sign in to continue
              </button>
            )}
          </section>
        ) : !overview && loading ? (
          <div className="loading">
            <LoaderCircle size={16} className="spin" /> Loading organization…
          </div>
        ) : (
          <>
            <section id="overview" className="metrics" aria-label="Overview">
              <Metric
                label="Members"
                value={overview?.members.length ?? 0}
                icon={Users}
              />
              <Metric
                label="Managed projects"
                value={overview?.projects.length ?? 0}
                icon={Database}
              />
              <Metric
                label="Registered gateways"
                value={overview?.gateways.length ?? 0}
                icon={Network}
              />
            </section>

            <section id="projects">
              <SectionHeading
                title="Managed projects"
                detail="Project assignments determine what members can discover."
                action={
                  <div className="header-actions">
                    <button
                      className="quiet-button"
                      onClick={() => setSourceOpen((value) => !value)}
                    >
                      <Database size={14} /> Add data source
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => setProjectOpen((value) => !value)}
                    >
                      <Plus size={14} /> New project
                    </button>
                  </div>
                }
              />
              {projectOpen && (
                <form className="inline-form" onSubmit={createProject}>
                  <label>
                    Project name
                    <input
                      required
                      maxLength={128}
                      value={projectName}
                      onChange={(event) => setProjectName(event.target.value)}
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    Create project
                  </button>
                </form>
              )}
              {sourceOpen && (
                <form className="inline-form" onSubmit={registerDataSource}>
                  <label>
                    Project
                    <select
                      required
                      value={sourceProjectId}
                      onChange={(event) =>
                        setSourceProjectId(event.target.value)
                      }
                    >
                      <option value="">Select project</option>
                      {overview?.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Gateway
                    <select
                      required
                      value={sourceGatewayId}
                      onChange={(event) =>
                        setSourceGatewayId(event.target.value)
                      }
                    >
                      <option value="">Select Gateway</option>
                      {overview?.gateways.map((gateway) => (
                        <option key={gateway.id} value={gateway.id}>
                          {gateway.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Display name
                    <input
                      required
                      maxLength={128}
                      value={sourceName}
                      onChange={(event) => setSourceName(event.target.value)}
                    />
                  </label>
                  <label>
                    Driver
                    <select
                      value={sourceDriver}
                      onChange={(event) => setSourceDriver(event.target.value)}
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                    </select>
                  </label>
                  <button className="primary-button" disabled={loading}>
                    Register data source
                  </button>
                </form>
              )}
              <div className="table">
                <div className="table-row table-head">
                  <span>Project</span>
                  <span>Data sources</span>
                  <span>Members</span>
                  <span>Policy revision</span>
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
                  <div className="empty">No managed projects assigned.</div>
                )}
              </div>
              <form className="inline-form" onSubmit={assignProject}>
                <label>
                  Project
                  <select
                    required
                    value={assignmentProjectId}
                    onChange={(event) =>
                      setAssignmentProjectId(event.target.value)
                    }
                  >
                    <option value="">Select project</option>
                    {overview?.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Member
                  <select
                    required
                    value={assignmentUserId}
                    onChange={(event) =>
                      setAssignmentUserId(event.target.value)
                    }
                  >
                    <option value="">Select member</option>
                    {overview?.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" disabled={loading}>
                  Assign project
                </button>
              </form>
            </section>

            <section id="members">
              <SectionHeading
                title="Members"
                detail="Personal identities keep their local projects when enterprise access changes."
                action={
                  <div className="header-actions">
                    <button
                      className="quiet-button"
                      onClick={() => setDeviceOpen((value) => !value)}
                    >
                      <KeyRound size={14} /> Enroll device
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => setInviteOpen((value) => !value)}
                    >
                      <Plus size={14} /> Invite member
                    </button>
                  </div>
                }
              />
              {inviteOpen && (
                <form className="inline-form" onSubmit={sendInvitation}>
                  <label>
                    Verified email
                    <input
                      type="email"
                      value={email}
                      required
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    Organization role
                    <select
                      value={role}
                      onChange={(event) => setRole(event.target.value)}
                    >
                      <option value="member">Member</option>
                      <option value="administrator">Administrator</option>
                    </select>
                  </label>
                  <button className="primary-button" disabled={loading}>
                    Send invitation
                  </button>
                </form>
              )}
              <div className="table">
                <div className="table-row member-row table-head">
                  <span>Member</span>
                  <span>Role</span>
                  <span>Status</span>
                </div>
                {overview?.members.map((member) => (
                  <div className="table-row member-row" key={member.id}>
                    <span>
                      <strong>{member.displayName}</strong>
                      <small>{member.email}</small>
                    </span>
                    <span>{member.role}</span>
                    <span className={`status ${member.status}`}>
                      {member.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section id="gateways">
              <SectionHeading
                title="Gateways"
                detail="Database credentials stay inside customer-controlled networks."
                action={
                  <button
                    className="primary-button"
                    onClick={() => setGatewayOpen((value) => !value)}
                  >
                    <Plus size={14} /> Register Gateway
                  </button>
                }
              />
              {gatewayOpen && (
                <form
                  className="inline-form gateway-registration-form"
                  onSubmit={registerGateway}
                >
                  <label>
                    Display name
                    <input
                      required
                      maxLength={128}
                      value={gatewayName}
                      onChange={(event) => setGatewayName(event.target.value)}
                    />
                  </label>
                  <label>
                    Direct mTLS endpoint
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
                    TLS certificate SHA-256
                    <input
                      required
                      minLength={64}
                      maxLength={64}
                      pattern="[A-Fa-f0-9]{64}"
                      placeholder="64 hexadecimal characters"
                      value={gatewayCertificateFingerprint}
                      onChange={(event) =>
                        setGatewayCertificateFingerprint(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Enrollment public key (Ed25519)
                    <input
                      required
                      minLength={44}
                      maxLength={44}
                      placeholder="base64-encoded 32-byte public key"
                      value={gatewayEnrollmentPublicKey}
                      onChange={(event) =>
                        setGatewayEnrollmentPublicKey(event.target.value)
                      }
                    />
                  </label>
                  <button className="primary-button" disabled={loading}>
                    Register Gateway
                  </button>
                </form>
              )}
              {deviceOpen && (
                <form className="inline-form device-enrollment-form" onSubmit={registerManagedDevice}>
                  <label>
                    Member
                    <select required value={deviceUserId} onChange={(event) => setDeviceUserId(event.target.value)}>
                      <option value="">Select member</option>
                      {overview?.members.filter((member) => member.status === "active").map((member) => (
                        <option key={member.id} value={member.id}>{member.displayName}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Device UUID
                    <input required value={deviceId} placeholder="Desktop enrollment ID" onChange={(event) => setDeviceId(event.target.value)} />
                  </label>
                  <label>
                    Client certificate SHA-256
                    <input required minLength={64} maxLength={64} pattern="[A-Fa-f0-9]{64}" value={deviceFingerprint} onChange={(event) => setDeviceFingerprint(event.target.value)} />
                  </label>
                  <label>
                    Device name
                    <input maxLength={128} value={deviceName} placeholder="Optional" onChange={(event) => setDeviceName(event.target.value)} />
                  </label>
                  <button className="primary-button" disabled={loading}>Enroll device</button>
                </form>
              )}
              {gatewayEnrollment && (
                <div className="enrollment-instructions" role="status">
                  <div>
                    <strong>Save this one-time enrollment token now.</strong>
                    <p>
                      The control plane stores only a digest. The Gateway must
                      present this token with the registered TLS certificate
                      before it can become active. It expires at{" "}
                      {new Date(
                        gatewayEnrollment.enrollment.expiresAt,
                      ).toLocaleString()}.
                    </p>
                  </div>
                  <label>
                    Enrollment token
                    <textarea
                      readOnly
                      value={gatewayEnrollment.enrollment.token}
                      aria-label="One-time Gateway enrollment token"
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
                    Write both the token and its matching Ed25519 private key
                    to private files (mode 0600 on Unix), then start the
                    Gateway. Do not add either to source control, shell
                    history, or a shared configuration file.
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
                      {gateway.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section id="policies">
              <SectionHeading
                title="Access policies"
                detail="Permissions are explicit, resource-scoped and deny by default. A forbid rule always wins."
              />
              <form className="policy-form" onSubmit={createGrant}>
                <div className="inline-form">
                  <label>
                    Project
                    <select
                      required
                      value={grantProjectId}
                      onChange={(event) => {
                        setGrantProjectId(event.target.value);
                        setGrantDataSourceId("");
                      }}
                    >
                      <option value="">Select project</option>
                      {overview?.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Member
                    <select
                      required
                      value={grantUserId}
                      onChange={(event) => setGrantUserId(event.target.value)}
                    >
                      <option value="">Select member</option>
                      {overview?.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Data source
                    <select
                      value={grantDataSourceId}
                      onChange={(event) =>
                        setGrantDataSourceId(event.target.value)
                      }
                    >
                      <option value="">All project data sources</option>
                      {grantProject?.dataSources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.displayName} · {source.driver}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Effect
                    <select
                      value={grantEffect}
                      onChange={(event) =>
                        setGrantEffect(
                          event.target.value as "permit" | "forbid",
                        )
                      }
                    >
                      <option value="permit">Permit</option>
                      <option value="forbid">Forbid</option>
                    </select>
                  </label>
                </div>
                <label>
                  Resource path
                  <input
                    value={grantPath}
                    placeholder="database/schema/table — blank means the whole data source"
                    onChange={(event) => setGrantPath(event.target.value)}
                  />
                </label>
                <fieldset className="action-options">
                  <legend>Allowed actions</legend>
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
                      {label}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="primary-button"
                  disabled={loading || grantActions.length === 0}
                >
                  Save policy
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Users;
}) {
  return (
    <div className="metric">
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
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
