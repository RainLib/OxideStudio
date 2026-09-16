import { Building2, Plus } from "lucide-react";
import type {
  AdminOverview,
  GatewayCertificateRotation,
  GatewayRegistration,
} from "../../../api";
import type { AdminLocale } from "../../../i18n";
import type { AdminSection } from "../model/adminPresentation";
import { accessActions, driverProfiles } from "../model/adminPresentation";
import { SectionHeading } from "./SectionHeading";

interface AdminInfrastructurePanelContext {
  activeSection: AdminSection;
  t: (
    key: string,
    variables?: Record<string, string | number> | undefined,
  ) => string;
  infrastructureView: "gateways" | "sources";
  setGatewayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSourceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInfrastructureView: React.Dispatch<
    React.SetStateAction<"gateways" | "sources">
  >;
  overview: AdminOverview | null;
  gatewayOpen: boolean;
  registerGateway: (event: React.FormEvent<Element>) => Promise<void>;
  gatewayName: string;
  setGatewayName: React.Dispatch<React.SetStateAction<string>>;
  gatewayEndpoint: string;
  setGatewayEndpoint: React.Dispatch<React.SetStateAction<string>>;
  gatewayCertificateFingerprint: string;
  setGatewayCertificateFingerprint: React.Dispatch<
    React.SetStateAction<string>
  >;
  gatewayEnrollmentPublicKey: string;
  setGatewayEnrollmentPublicKey: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  gatewayEnrollment: GatewayRegistration | null;
  locale: AdminLocale;
  gatewayRotationTarget: string | null;
  rotateGatewayCertificate: (event: React.FormEvent<Element>) => Promise<void>;
  gatewayRotationFingerprint: string;
  setGatewayRotationFingerprint: React.Dispatch<React.SetStateAction<string>>;
  setGatewayRotationTarget: React.Dispatch<React.SetStateAction<string | null>>;
  gatewayRotation: GatewayCertificateRotation | null;
  setGatewayRotation: React.Dispatch<
    React.SetStateAction<GatewayCertificateRotation | null>
  >;
  revokeGateway: (gatewayId: string) => Promise<void>;
  sourceOpen: boolean;
  registerDataSource: (event: React.FormEvent<Element>) => Promise<void>;
  sourceProjectId: string;
  setSourceProjectId: React.Dispatch<React.SetStateAction<string>>;
  sourceGatewayId: string;
  setSourceGatewayId: React.Dispatch<React.SetStateAction<string>>;
  sourceName: string;
  setSourceName: React.Dispatch<React.SetStateAction<string>>;
  sourceDriver: string;
  setSourceDriver: React.Dispatch<React.SetStateAction<string>>;
  sourceTargetBinding: string;
  setSourceTargetBinding: React.Dispatch<React.SetStateAction<string>>;
  renewDataSourceTargetBinding: (
    event: React.FormEvent<Element>,
  ) => Promise<void>;
  renewSourceId: string;
  setRenewSourceId: React.Dispatch<React.SetStateAction<string>>;
  renewTargetBinding: string;
  setRenewTargetBinding: React.Dispatch<React.SetStateAction<string>>;
}

export function AdminInfrastructurePanel({
  activeSection,
  t,
  infrastructureView,
  setGatewayOpen,
  setSourceOpen,
  setInfrastructureView,
  overview,
  gatewayOpen,
  registerGateway,
  gatewayName,
  setGatewayName,
  gatewayEndpoint,
  setGatewayEndpoint,
  gatewayCertificateFingerprint,
  setGatewayCertificateFingerprint,
  gatewayEnrollmentPublicKey,
  setGatewayEnrollmentPublicKey,
  loading,
  gatewayEnrollment,
  locale,
  gatewayRotationTarget,
  rotateGatewayCertificate,
  gatewayRotationFingerprint,
  setGatewayRotationFingerprint,
  setGatewayRotationTarget,
  gatewayRotation,
  setGatewayRotation,
  revokeGateway,
  sourceOpen,
  registerDataSource,
  sourceProjectId,
  setSourceProjectId,
  sourceGatewayId,
  setSourceGatewayId,
  sourceName,
  setSourceName,
  sourceDriver,
  setSourceDriver,
  sourceTargetBinding,
  setSourceTargetBinding,
  renewDataSourceTargetBinding,
  renewSourceId,
  setRenewSourceId,
  renewTargetBinding,
  setRenewTargetBinding,
}: AdminInfrastructurePanelContext) {
  return (
    <section
      className="module-pane"
      hidden={activeSection !== "infrastructure"}
    >
      <SectionHeading
        title={t("Infrastructure")}
        detail={t(
          "Manage gateway connectivity and the credential-free data sources bound to it.",
        )}
        action={
          infrastructureView === "gateways" ? (
            <button
              className="primary-button"
              onClick={() => setGatewayOpen((value) => !value)}
            >
              <Plus size={14} /> {t("Register Gateway")}
            </button>
          ) : (
            <button
              className="primary-button"
              onClick={() => setSourceOpen((value) => !value)}
            >
              <Plus size={14} /> {t("Add data source")}
            </button>
          )
        }
      />
      <div
        className="section-tabs"
        role="tablist"
        aria-label={t("Infrastructure resources")}
      >
        <button
          className={infrastructureView === "gateways" ? "active" : ""}
          onClick={() => setInfrastructureView("gateways")}
          role="tab"
          aria-selected={infrastructureView === "gateways"}
        >
          {t("Gateways")} <span>{overview?.gateways.length ?? 0}</span>
        </button>
        <button
          className={infrastructureView === "sources" ? "active" : ""}
          onClick={() => setInfrastructureView("sources")}
          role="tab"
          aria-selected={infrastructureView === "sources"}
        >
          {t("Data sources")}{" "}
          <span>
            {overview?.projects.reduce(
              (total, project) => total + project.dataSourceCount,
              0,
            ) ?? 0}
          </span>
        </button>
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
                  onChange={(event) => setGatewayEndpoint(event.target.value)}
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
                  {t(
                    "The control plane stores only a digest. The Gateway must present this token with the registered TLS certificate before it can become active. It expires at {time}.",
                    {
                      time: new Date(
                        gatewayEnrollment.enrollment.expiresAt,
                      ).toLocaleString(locale),
                    },
                  )}
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
                OXIDE_GATEWAY_ID={gatewayEnrollment.id}
                {"\n"}
                OXIDE_GATEWAY_PUBLIC_ENDPOINT={gatewayEnrollment.directEndpoint}
                {"\n"}
                OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE=/run/secrets/oxide-gateway-enrollment
                {"\n"}
                OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE=/run/secrets/oxide-gateway-enrollment-key
              </code>
              <p className="enrollment-note">
                {t(
                  "Write both the token and its matching Ed25519 private key to private files (mode 0600 on Unix), then start the Gateway. Do not add either to source control, shell history, or a shared configuration file.",
                )}
              </p>
            </div>
          )}
          {gatewayRotationTarget && (
            <form
              className="inline-form gateway-rotation-form"
              onSubmit={rotateGatewayCertificate}
            >
              <label>
                {t("Replacement TLS certificate SHA-256")}
                <input
                  required
                  minLength={64}
                  maxLength={64}
                  pattern="[A-Fa-f0-9]{64}"
                  placeholder={t("64 hexadecimal characters")}
                  value={gatewayRotationFingerprint}
                  onChange={(event) =>
                    setGatewayRotationFingerprint(event.target.value)
                  }
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
                <strong>
                  {t("Save this one-time certificate rotation token now.")}
                </strong>
                <p>
                  {t(
                    "Deploy the replacement TLS certificate, keep the existing Gateway signing-key file, and restart before {time}.",
                    {
                      time: new Date(
                        gatewayRotation.enrollment.expiresAt,
                      ).toLocaleString(locale),
                    },
                  )}
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
                OXIDE_GATEWAY_ID={gatewayRotation.id}
                {"\n"}
                OXIDE_GATEWAY_ENROLLMENT_TOKEN_FILE=/run/secrets/oxide-gateway-certificate-rotation
                {"\n"}
                OXIDE_GATEWAY_ENROLLMENT_SIGNING_KEY_FILE=/run/secrets/oxide-gateway-enrollment-key
              </code>
              <p className="enrollment-note">
                {t(
                  "The control plane never receives the private key. Remove the token file after the new Gateway instance is active.",
                )}
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
                    loading || !["pending", "active"].includes(gateway.status)
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
            <form
              className="inline-form source-registration-form"
              onSubmit={registerDataSource}
            >
              <label>
                {t("Project")}
                <select
                  required
                  value={sourceProjectId}
                  onChange={(event) => setSourceProjectId(event.target.value)}
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
                {t("Gateway")}
                <select
                  required
                  value={sourceGatewayId}
                  onChange={(event) => setSourceGatewayId(event.target.value)}
                >
                  <option value="">{t("Select Gateway")}</option>
                  {overview?.gateways.map((gateway) => (
                    <option key={gateway.id} value={gateway.id}>
                      {gateway.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Display name")}
                <input
                  required
                  maxLength={128}
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                />
              </label>
              <label>
                {t("Driver")}
                <select
                  value={sourceDriver}
                  onChange={(event) => setSourceDriver(event.target.value)}
                >
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mongodb">MongoDB</option>
                  <option value="elasticsearch">Elasticsearch</option>
                  <option value="redis">Redis</option>
                </select>
              </label>
              <label className="source-target-binding">
                {t("Target binding")}
                <input
                  required
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  pattern="[a-fA-F0-9]{64}"
                  placeholder={t("Gateway-generated SHA-256 fingerprint")}
                  value={sourceTargetBinding}
                  onChange={(event) =>
                    setSourceTargetBinding(event.target.value)
                  }
                />
              </label>
              <p className="inline-form-hint source-binding-hint">
                {t(
                  "Paste the credential-free fingerprint generated beside the Gateway. No connection URL or secret is sent here.",
                )}
              </p>
              <button className="primary-button" disabled={loading}>
                {t("Register data source")}
              </button>
            </form>
          )}
          <div className="table source-table">
            <div className="table-row table-head">
              <span>{t("Data source")}</span>
              <span>{t("Driver")}</span>
              <span>{t("Project")}</span>
              <span>{t("Gateway")}</span>
              <span>{t("Capabilities")}</span>
              <span>{t("Binding")}</span>
            </div>
            {overview?.projects.flatMap((project) =>
              project.dataSources.map((source) => {
                const profile = driverProfiles[source.driver] ?? {
                  label: source.driver,
                  model: "Database connection",
                };
                return (
                  <div className="table-row" key={source.id}>
                    <span>
                      <strong>{source.displayName}</strong>
                      <small>
                        {source.allowedResourceSummary.join(" · ") || source.id}
                      </small>
                    </span>
                    <span>
                      <strong>{profile.label}</strong>
                      <small>{t(profile.model)}</small>
                    </span>
                    <span>{project.displayName}</span>
                    <span>
                      <strong>{source.gatewayName}</strong>
                      <small
                        className={`connection-state ${source.gatewayStatus}`}
                      >
                        {t(source.gatewayStatus)}
                      </small>
                    </span>
                    <code>
                      {source.capabilities
                        .map((capability) =>
                          t(
                            accessActions.find(
                              ([value]) => value === capability,
                            )?.[1] ?? capability,
                          ),
                        )
                        .join(" · ")}
                    </code>
                    <code title={source.targetBinding}>
                      {source.targetBinding
                        ? `${source.targetBinding.slice(0, 12)}…`
                        : t("Not bound")}
                    </code>
                  </div>
                );
              }),
            )}
            {overview?.projects.every(
              (project) => project.dataSources.length === 0,
            ) && (
              <div className="empty">{t("No data sources registered.")}</div>
            )}
          </div>
          <form
            className="inline-form renew-binding-form"
            onSubmit={renewDataSourceTargetBinding}
          >
            <label>
              {t("Renew source binding")}
              <select
                required
                value={renewSourceId}
                onChange={(event) => setRenewSourceId(event.target.value)}
              >
                <option value="">{t("Select data source")}</option>
                {overview?.projects
                  .flatMap((project) => project.dataSources)
                  .map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.displayName} · {source.driver}
                    </option>
                  ))}
              </select>
            </label>
            <label className="source-target-binding">
              {t("New target binding")}
              <input
                required
                maxLength={64}
                pattern="[a-fA-F0-9]{64}"
                autoComplete="off"
                spellCheck={false}
                value={renewTargetBinding}
                onChange={(event) => setRenewTargetBinding(event.target.value)}
              />
            </label>
            <button className="quiet-button" disabled={loading}>
              {t("Renew binding")}
            </button>
            <p className="inline-form-hint source-binding-hint">
              {t(
                "Update this only after changing the Gateway-local source. Existing grants and the data source ID stay intact.",
              )}
            </p>
          </form>
        </div>
      )}
    </section>
  );
}
