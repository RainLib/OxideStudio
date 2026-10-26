import { readProjectConnections } from "@/features/connections/model/connectionScope";
import { managedCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { Project } from "@/services/tauri/store.service";
import { useEnterpriseAccountStore } from "@/store/useEnterpriseAccountStore";

export function enterpriseProjects(): Project[] {
  const { memberships, managedProjects } =
    useEnterpriseAccountStore.getState().status;
  const organizations = new Map(
    memberships.map((membership) => [
      membership.organization.id,
      membership.organization.displayName,
    ]),
  );
  const now = Date.now();
  return managedProjects.map((project) => ({
    id: project.id,
    name: project.displayName,
    root_path: null,
    created_at: now,
    updated_at: now,
    origin: "managed" as const,
    organization_id: project.organizationId,
    organization_name:
      organizations.get(project.organizationId) || project.organizationId,
    policy_revision: project.policyRevision,
    managed_data_sources: project.dataSources,
  }));
}

export function mergeProjects(localProjects: Project[]) {
  return [
    ...localProjects.map((project) => ({ ...project, origin: "local" as const })),
    ...enterpriseProjects(),
  ];
}

export function managedProjectConnections(
  project: Project,
): Awaited<ReturnType<typeof readProjectConnections>> {
  return (project.managed_data_sources || []).map((descriptor) => ({
    id: descriptor.dataSourceId,
    projectId: project.id,
    name: descriptor.displayName,
    driver: descriptor.driver,
    url: "",
    connectionUrl: "",
    origin: "managed" as const,
    managedDescriptor: descriptor,
    database: managedCatalogDatabaseName(descriptor),
  }));
}
