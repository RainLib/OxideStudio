import { invokeRawCommand } from "./client";
import type { DatabaseDriver } from "./types";

export type EnterpriseAccountState = "anonymous" | "authenticated";
export type MembershipStatus = "invited" | "active" | "suspended";

export interface EnterpriseUser {
  id: string;
  displayName: string;
  verifiedEmails: string[];
}

export interface OrganizationSummary {
  id: string;
  displayName: string;
}

export interface OrganizationMembership {
  userId: string;
  status: MembershipStatus;
  organizationRole: string;
  authPolicyRevision: string;
  organization: OrganizationSummary;
}

export interface ManagedDataSourceDescriptor {
  organizationId: string;
  projectId: string;
  dataSourceId: string;
  gatewayId: string;
  driver: DatabaseDriver;
  displayName: string;
  capabilities: string[];
  allowedResourceSummary: string[];
  policyRevision: string;
}

export interface ManagedProject {
  id: string;
  organizationId: string;
  displayName: string;
  policyRevision: string;
  dataSources: ManagedDataSourceDescriptor[];
}

export interface EnterpriseAccountStatus {
  configured: boolean;
  state: EnterpriseAccountState;
  user?: EnterpriseUser | null;
  memberships: OrganizationMembership[];
  managedProjects: ManagedProject[];
  syncError?: string | null;
}

export interface EnterprisePublicConfig {
  controlPlaneUrl: string;
  oidcIssuer: string;
  oidcClientId: string;
  gatewayCaCertificatePath?: string | null;
  gatewayClientCertificatePath?: string | null;
  gatewayClientPrivateKeyPath?: string | null;
}

export const enterpriseService = {
  getPublicConfig: () =>
    invokeRawCommand<EnterprisePublicConfig | null>(
      "enterprise_get_public_config",
    ),

  getStatus: () =>
    invokeRawCommand<EnterpriseAccountStatus>(
      "enterprise_get_account_status",
    ),

  configure: (config: EnterprisePublicConfig) =>
    invokeRawCommand<EnterpriseAccountStatus>(
      "enterprise_configure_account",
      { config },
    ),

  signIn: () =>
    invokeRawCommand<EnterpriseAccountStatus>("enterprise_sign_in"),

  syncProjects: () =>
    invokeRawCommand<EnterpriseAccountStatus>(
      "enterprise_sync_projects",
    ),

  signOut: () =>
    invokeRawCommand<EnterpriseAccountStatus>("enterprise_sign_out"),

  connectManagedSource: (
    connectionId: string,
    descriptor: ManagedDataSourceDescriptor,
  ) =>
    invokeRawCommand<string>("enterprise_connect_managed_source", {
      connectionId,
      descriptor,
    }),
};
