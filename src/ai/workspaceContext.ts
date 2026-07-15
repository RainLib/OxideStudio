import type { UiActionContextSnapshot } from "./ui-actions/types";

export type WorkspaceContextBinding = {
  version: 1;
  contextVersion: number;
  fingerprint: string;
  projectId: string;
  activeConnectionId: string | null;
  activeDriver: string | null;
  activeDatabaseName: string | null;
  activeNamespace: string | null;
  activeTabId: string | null;
  documentRevision: string | null;
  selectionRevision: string | null;
};

export function createWorkspaceContextBinding(
  snapshot: UiActionContextSnapshot,
): WorkspaceContextBinding {
  const identity = {
    projectId: snapshot.projectId,
    activeConnectionId: snapshot.activeConnectionId,
    activeDriver: snapshot.activeDriver,
    activeDatabaseName: snapshot.activeDatabaseName,
    activeNamespace: snapshot.activeNamespace,
    activeTabId: snapshot.activeTabId,
    documentRevision: snapshot.documentRevision,
    selectionRevision: snapshot.selectionRevision,
  };
  return {
    version: 1,
    contextVersion: snapshot.contextVersion,
    fingerprint: hashContextIdentity(JSON.stringify(identity)),
    ...identity,
  };
}

export function workspaceContextStaleReason(
  expected: WorkspaceContextBinding | null | undefined,
  current: WorkspaceContextBinding | null | undefined,
) {
  if (!expected || !current) return null;
  if (
    expected.contextVersion === current.contextVersion &&
    expected.fingerprint === current.fingerprint
  ) {
    return null;
  }
  if (expected.projectId !== current.projectId) return "The active project changed.";
  if (expected.activeConnectionId !== current.activeConnectionId) {
    return "The active data source changed.";
  }
  if (expected.activeDriver !== current.activeDriver) {
    return "The active database driver changed.";
  }
  if (expected.activeDatabaseName !== current.activeDatabaseName) {
    return "The active database changed.";
  }
  if (expected.activeNamespace !== current.activeNamespace) {
    return "The active schema or namespace changed.";
  }
  if (expected.activeTabId !== current.activeTabId) {
    return "The active editor changed.";
  }
  if (expected.documentRevision !== current.documentRevision) {
    return "The active document changed.";
  }
  if (expected.selectionRevision !== current.selectionRevision) {
    return "The editor selection changed.";
  }
  return "The workspace context changed.";
}

function hashContextIdentity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ctx-${(hash >>> 0).toString(36)}`;
}
