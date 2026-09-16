import {
  FolderKanban,
  KeyRound,
  LoaderCircle,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAdminInfrastructureForms } from "./features/admin/hooks/useAdminInfrastructureForms";
import { useAdminMemberForms } from "./features/admin/hooks/useAdminMemberForms";
import { useAdminOrganizationForm } from "./features/admin/hooks/useAdminOrganizationForm";
import { useAdminPolicyForms } from "./features/admin/hooks/useAdminPolicyForms";
import { useAdminProjectForms } from "./features/admin/hooks/useAdminProjectForms";
import { useAdminSession } from "./features/admin/hooks/useAdminSession";
import { type AdminSection } from "./features/admin/model/adminPresentation";
import { createAdminInfrastructureActions } from "./features/admin/model/createAdminInfrastructureActions";
import { createAdminMemberActions } from "./features/admin/model/createAdminMemberActions";
import { createAdminOrganizationActions } from "./features/admin/model/createAdminOrganizationActions";
import { createAdminPolicyActions } from "./features/admin/model/createAdminPolicyActions";
import { createAdminProjectActions } from "./features/admin/model/createAdminProjectActions";
import { organizationId } from "./features/admin/runtime/adminContext";
import { AdminAuditPanel } from "./features/admin/ui/AdminAuditPanel";
import { AdminContextBar } from "./features/admin/ui/AdminContextBar";
import { AdminInfrastructurePanel } from "./features/admin/ui/AdminInfrastructurePanel";
import { AdminMembersPanel } from "./features/admin/ui/AdminMembersPanel";
import { AdminNavigation } from "./features/admin/ui/AdminNavigation";
import { AdminOnboarding } from "./features/admin/ui/AdminOnboarding";
import { AdminOrganizationBaseline } from "./features/admin/ui/AdminOrganizationBaseline";
import { AdminOverviewPanel } from "./features/admin/ui/AdminOverviewPanel";
import { AdminPoliciesPanel } from "./features/admin/ui/AdminPoliciesPanel";
import { AdminProjectsPanel } from "./features/admin/ui/AdminProjectsPanel";
import { AdminSignIn } from "./features/admin/ui/AdminSignIn";

export function App() {
  const {
    activeSection,
    locale,
    setLocale,
    overview,
    auditEvents,
    auditLoading,
    error,
    setError,
    loading,
    setLoading,
    signedIn,
    t,
    refresh,
    refreshAuditEvents,
  } = useAdminSession();

  const {
    inviteOpen,
    setInviteOpen,
    deviceOpen,
    setDeviceOpen,
    email,
    setEmail,
    role,
    setRole,
    deviceUserId,
    setDeviceUserId,
    deviceId,
    setDeviceId,
    deviceFingerprint,
    setDeviceFingerprint,
    deviceName,
    setDeviceName,
  } = useAdminMemberForms();

  const {
    projectOpen,
    setProjectOpen,
    projectName,
    setProjectName,
    assignmentProjectId,
    setAssignmentProjectId,
    assignmentUserId,
    setAssignmentUserId,
  } = useAdminProjectForms();

  const {
    gatewayOpen,
    setGatewayOpen,
    sourceOpen,
    setSourceOpen,
    infrastructureView,
    setInfrastructureView,
    gatewayName,
    setGatewayName,
    gatewayEndpoint,
    setGatewayEndpoint,
    gatewayCertificateFingerprint,
    setGatewayCertificateFingerprint,
    gatewayEnrollmentPublicKey,
    setGatewayEnrollmentPublicKey,
    gatewayEnrollment,
    setGatewayEnrollment,
    gatewayRotation,
    setGatewayRotation,
    gatewayRotationTarget,
    setGatewayRotationTarget,
    gatewayRotationFingerprint,
    setGatewayRotationFingerprint,
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
    renewSourceId,
    setRenewSourceId,
    renewTargetBinding,
    setRenewTargetBinding,
  } = useAdminInfrastructureForms();

  const {
    grantProjectId,
    setGrantProjectId,
    grantUserId,
    setGrantUserId,
    grantDataSourceId,
    setGrantDataSourceId,
    grantPath,
    setGrantPath,
    grantEffect,
    setGrantEffect,
    grantActions,
    setGrantActions,
    ticketNonce,
    setTicketNonce,
    ticketRevocationReason,
    setTicketRevocationReason,
  } = useAdminPolicyForms();

  const {
    organizationName,
    setOrganizationName,
    organizationSlug,
    setOrganizationSlug,
  } = useAdminOrganizationForm();

  const {
    sendInvitation,
    registerManagedDevice,
    revokeManagedDevice,
    suspendMember,
    activateMember,
    transferOrganizationOwnership,
  } = createAdminMemberActions({
    setLoading,
    setError,
    email,
    role,
    setInviteOpen,
    setEmail,
    refresh,
    deviceUserId,
    deviceId,
    deviceFingerprint,
    deviceName,
    setDeviceOpen,
    setDeviceUserId,
    setDeviceId,
    setDeviceFingerprint,
    setDeviceName,
    t,
  });

  const { createProject, assignProject } = createAdminProjectActions({
    setLoading,
    setError,
    projectName,
    setProjectName,
    setProjectOpen,
    refresh,
    assignmentProjectId,
    assignmentUserId,
  });

  const {
    revokeGateway,
    registerGateway,
    rotateGatewayCertificate,
    registerDataSource,
    renewDataSourceTargetBinding,
  } = createAdminInfrastructureActions({
    setLoading,
    setError,
    refresh,
    gatewayName,
    gatewayEndpoint,
    gatewayCertificateFingerprint,
    gatewayEnrollmentPublicKey,
    setGatewayName,
    setGatewayEndpoint,
    setGatewayCertificateFingerprint,
    setGatewayEnrollmentPublicKey,
    setGatewayOpen,
    setGatewayEnrollment,
    gatewayRotationTarget,
    gatewayRotationFingerprint,
    setGatewayRotation,
    setGatewayRotationTarget,
    setGatewayRotationFingerprint,
    sourceProjectId,
    sourceGatewayId,
    sourceDriver,
    sourceTargetBinding,
    sourceName,
    setSourceName,
    setSourceTargetBinding,
    setSourceOpen,
    renewSourceId,
    renewTargetBinding,
    setRenewSourceId,
    setRenewTargetBinding,
  });

  const { revokeAccessTicket, createGrant } = createAdminPolicyActions({
    setLoading,
    setError,
    ticketNonce,
    ticketRevocationReason,
    setTicketNonce,
    setTicketRevocationReason,
    grantProjectId,
    grantUserId,
    grantDataSourceId,
    grantPath,
    grantActions,
    grantEffect,
    refresh,
  });

  const { setMinimumDesktopVersion, createOrganization } =
    createAdminOrganizationActions({
      setLoading,
      setError,
      refresh,
      organizationSlug,
      organizationName,
    });

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

  const activeGateways =
    overview?.gateways.filter((gateway) => gateway.status === "active")
      .length ?? 0;

  return (
    <div
      className={`admin-shell ${organizationId && signedIn ? "is-ready" : "is-onboarding"}`}
    >
      {organizationId && signedIn && (
        <AdminNavigation
          overview={overview}
          t={t}
          navigationItems={navigationItems}
          activeSection={activeSection}
        />
      )}

      <main>
        <AdminContextBar
          signedIn={signedIn}
          overview={overview}
          t={t}
          activeSection={activeSection}
          activeGateways={activeGateways}
          refresh={refresh}
          loading={loading}
          locale={locale}
          setLocale={setLocale}
        />

        {error && (
          <div className="error-line" role="alert">
            {t(error)}
          </div>
        )}
        {!signedIn ? (
          <AdminSignIn t={t} />
        ) : !organizationId ? (
          <AdminOnboarding
            t={t}
            signedIn={signedIn}
            createOrganization={createOrganization}
            organizationName={organizationName}
            setOrganizationName={setOrganizationName}
            organizationSlug={organizationSlug}
            setOrganizationSlug={setOrganizationSlug}
            loading={loading}
          />
        ) : !overview && loading ? (
          <div className="loading">
            <LoaderCircle size={16} className="spin" />{" "}
            {t("Loading organization…")}
          </div>
        ) : (
          <>
            <AdminOverviewPanel
              activeSection={activeSection}
              t={t}
              refresh={refresh}
              loading={loading}
              overview={overview}
              activeGateways={activeGateways}
            />

            <AdminProjectsPanel
              activeSection={activeSection}
              t={t}
              setProjectOpen={setProjectOpen}
              projectOpen={projectOpen}
              createProject={createProject}
              projectName={projectName}
              setProjectName={setProjectName}
              loading={loading}
              overview={overview}
              assignProject={assignProject}
              assignmentProjectId={assignmentProjectId}
              setAssignmentProjectId={setAssignmentProjectId}
              assignmentUserId={assignmentUserId}
              setAssignmentUserId={setAssignmentUserId}
            />

            <AdminMembersPanel
              activeSection={activeSection}
              t={t}
              setDeviceOpen={setDeviceOpen}
              setInviteOpen={setInviteOpen}
              inviteOpen={inviteOpen}
              sendInvitation={sendInvitation}
              email={email}
              setEmail={setEmail}
              role={role}
              setRole={setRole}
              loading={loading}
              deviceOpen={deviceOpen}
              registerManagedDevice={registerManagedDevice}
              deviceUserId={deviceUserId}
              setDeviceUserId={setDeviceUserId}
              overview={overview}
              deviceId={deviceId}
              setDeviceId={setDeviceId}
              deviceFingerprint={deviceFingerprint}
              setDeviceFingerprint={setDeviceFingerprint}
              deviceName={deviceName}
              setDeviceName={setDeviceName}
              transferOrganizationOwnership={transferOrganizationOwnership}
              suspendMember={suspendMember}
              activateMember={activateMember}
              revokeManagedDevice={revokeManagedDevice}
            />

            <AdminOrganizationBaseline
              activeSection={activeSection}
              t={t}
              setMinimumDesktopVersion={setMinimumDesktopVersion}
              overview={overview}
              loading={loading}
            />

            <AdminInfrastructurePanel
              activeSection={activeSection}
              t={t}
              infrastructureView={infrastructureView}
              setGatewayOpen={setGatewayOpen}
              setSourceOpen={setSourceOpen}
              setInfrastructureView={setInfrastructureView}
              overview={overview}
              gatewayOpen={gatewayOpen}
              registerGateway={registerGateway}
              gatewayName={gatewayName}
              setGatewayName={setGatewayName}
              gatewayEndpoint={gatewayEndpoint}
              setGatewayEndpoint={setGatewayEndpoint}
              gatewayCertificateFingerprint={gatewayCertificateFingerprint}
              setGatewayCertificateFingerprint={
                setGatewayCertificateFingerprint
              }
              gatewayEnrollmentPublicKey={gatewayEnrollmentPublicKey}
              setGatewayEnrollmentPublicKey={setGatewayEnrollmentPublicKey}
              loading={loading}
              gatewayEnrollment={gatewayEnrollment}
              locale={locale}
              gatewayRotationTarget={gatewayRotationTarget}
              rotateGatewayCertificate={rotateGatewayCertificate}
              gatewayRotationFingerprint={gatewayRotationFingerprint}
              setGatewayRotationFingerprint={setGatewayRotationFingerprint}
              setGatewayRotationTarget={setGatewayRotationTarget}
              gatewayRotation={gatewayRotation}
              setGatewayRotation={setGatewayRotation}
              revokeGateway={revokeGateway}
              sourceOpen={sourceOpen}
              registerDataSource={registerDataSource}
              sourceProjectId={sourceProjectId}
              setSourceProjectId={setSourceProjectId}
              sourceGatewayId={sourceGatewayId}
              setSourceGatewayId={setSourceGatewayId}
              sourceName={sourceName}
              setSourceName={setSourceName}
              sourceDriver={sourceDriver}
              setSourceDriver={setSourceDriver}
              sourceTargetBinding={sourceTargetBinding}
              setSourceTargetBinding={setSourceTargetBinding}
              renewDataSourceTargetBinding={renewDataSourceTargetBinding}
              renewSourceId={renewSourceId}
              setRenewSourceId={setRenewSourceId}
              renewTargetBinding={renewTargetBinding}
              setRenewTargetBinding={setRenewTargetBinding}
            />

            <AdminPoliciesPanel
              activeSection={activeSection}
              t={t}
              createGrant={createGrant}
              grantProjectId={grantProjectId}
              setGrantProjectId={setGrantProjectId}
              setGrantDataSourceId={setGrantDataSourceId}
              overview={overview}
              grantUserId={grantUserId}
              setGrantUserId={setGrantUserId}
              grantDataSourceId={grantDataSourceId}
              grantProject={grantProject}
              grantEffect={grantEffect}
              setGrantEffect={setGrantEffect}
              grantPath={grantPath}
              setGrantPath={setGrantPath}
              grantActions={grantActions}
              setGrantActions={setGrantActions}
              loading={loading}
            />

            <AdminAuditPanel
              activeSection={activeSection}
              t={t}
              auditLoading={auditLoading}
              refreshAuditEvents={refreshAuditEvents}
              revokeAccessTicket={revokeAccessTicket}
              ticketNonce={ticketNonce}
              setTicketNonce={setTicketNonce}
              ticketRevocationReason={ticketRevocationReason}
              setTicketRevocationReason={setTicketRevocationReason}
              loading={loading}
              auditEvents={auditEvents}
              locale={locale}
            />
          </>
        )}
      </main>
    </div>
  );
}
