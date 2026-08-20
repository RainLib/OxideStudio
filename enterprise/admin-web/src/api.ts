export interface AdminOverview {
  organization: { id: string; displayName: string };
  viewerRole: string;
  members: Array<{
    id: string;
    displayName: string;
    email: string;
    status: string;
    role: string;
  }>;
  projects: Array<{
    id: string;
    displayName: string;
    memberCount: number;
    dataSourceCount: number;
    policyRevision: string;
    dataSources: Array<{
      id: string;
      displayName: string;
      driver: string;
    }>;
  }>;
  gateways: Array<{
    id: string;
    displayName: string;
    status: string;
    lastSeenAt?: string;
  }>;
  managedDevices: Array<{
    userId: string;
    userDisplayName: string;
    deviceId: string;
    certificateFingerprint: string;
    displayName?: string;
    status: "active" | "revoked";
    enrolledAt: string;
    revokedAt?: string;
  }>;
}

export interface AdminAuditEvent {
  occurredAt: string;
  userId?: string;
  projectId?: string;
  dataSourceId?: string;
  resourcePath?: unknown;
  action: string;
  decision: string;
  reasonCode: string;
  requestId: string;
  source: string;
  metadata: Record<string, unknown>;
}

export interface GatewayRegistration {
  id: string;
  displayName: string;
  directEndpoint: string;
  status: "pending";
  enrollment: {
    token: string;
    expiresAt: string;
    certificateFingerprint: string;
  };
}

export interface GatewayCertificateRotation {
  id: string;
  status: "rotationPending";
  enrollment: {
    token: string;
    expiresAt: string;
    certificateFingerprint: string;
  };
}

const baseUrl = (
  import.meta.env.VITE_OXIDE_CONTROL_PLANE_URL || ""
).replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const accessToken = adminAuth.accessToken();
  if (!accessToken) throw new Error("Sign in to administer this organization.");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "omit",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      payload?.error?.message || `Enterprise request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export const adminApi = {
  createOrganization: (slug: string, displayName: string) =>
    request<{ id: string }>("/v1/organizations", {
      method: "POST",
      body: JSON.stringify({ slug, displayName }),
    }),
  overview: (organizationId: string) =>
    request<AdminOverview>(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/overview`,
    ),
  auditEvents: (organizationId: string) =>
    request<{ events: AdminAuditEvent[] }>(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/audit-events`,
    ),
  invite: (organizationId: string, email: string, role: string) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ email, role }),
      },
    ),
  createProject: (organizationId: string, displayName: string) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/managed-projects`,
      {
        method: "POST",
        body: JSON.stringify({ displayName }),
      },
    ),
  registerGateway: (
    organizationId: string,
    displayName: string,
    directEndpoint: string,
    certificateFingerprint: string,
    enrollmentPublicKey: string,
  ) =>
    request<GatewayRegistration>(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/gateways`,
      {
        method: "POST",
        body: JSON.stringify({
          displayName,
          directEndpoint,
          certificateFingerprint,
          enrollmentPublicKey,
        }),
      },
    ),
  rotateGatewayCertificate: (
    organizationId: string,
    gatewayId: string,
    certificateFingerprint: string,
  ) =>
    request<GatewayCertificateRotation>(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/gateways/${encodeURIComponent(gatewayId)}/rotate-certificate`,
      {
        method: "POST",
        body: JSON.stringify({ certificateFingerprint }),
      },
    ),
  registerDataSource: (
    organizationId: string,
    input: {
      projectId: string;
      gatewayId: string;
      driver: string;
      displayName: string;
      capabilities: string[];
    },
  ) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/data-sources`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  registerManagedDevice: (
    organizationId: string,
    input: {
      userId: string;
      deviceId: string;
      certificateFingerprint: string;
      displayName?: string;
    },
  ) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/managed-devices`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  revokeManagedDevice: (
    organizationId: string,
    input: { userId: string; deviceId: string },
  ) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/managed-devices/revoke`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  suspendMember: (organizationId: string, memberId: string) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/suspend`,
      { method: "POST" },
    ),
  activateMember: (organizationId: string, memberId: string) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/activate`,
      { method: "POST" },
    ),
  transferOrganizationOwnership: (organizationId: string, memberId: string) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/transfer-ownership`,
      { method: "POST" },
    ),
  revokeGateway: (organizationId: string, gatewayId: string) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/gateways/${encodeURIComponent(gatewayId)}/revoke`,
      { method: "POST" },
    ),
  revokeAccessTicket: (
    organizationId: string,
    input: { nonce: string; reason: string },
  ) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/access-tickets/revoke`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  assignProject: (
    organizationId: string,
    projectId: string,
    principalId: string,
  ) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/project-assignments`,
      {
        method: "POST",
        body: JSON.stringify({
          projectId,
          principalKind: "user",
          principalId,
        }),
      },
    ),
  createGrant: (
    organizationId: string,
    input: {
      projectId: string;
      principalId: string;
      dataSourceId?: string;
      resourcePath: string[];
      actions: string[];
      effect: "permit" | "forbid";
    },
  ) =>
    request(
      `/v1/admin/organizations/${encodeURIComponent(organizationId)}/access-grants`,
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          dataSourceId: input.dataSourceId || null,
          principalKind: "user",
        }),
      },
    ),
};
import { adminAuth } from "./auth";
