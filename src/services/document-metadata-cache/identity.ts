import type { DocumentMetadataCacheIdentity } from "./contracts";

export function documentMetadataCacheScope(
  identity: DocumentMetadataCacheIdentity,
): string {
  return [identity.projectId, identity.connectionId, identity.driver]
    .map((part) => encodeURIComponent(part))
    .join("\u0000");
}

export function documentMetadataCacheKey(
  identity: DocumentMetadataCacheIdentity & {
    namespace: string;
    kind: "collections" | "fields";
    objectName?: string;
  },
): string {
  return [
    documentMetadataCacheScope(identity),
    encodeURIComponent(identity.namespace),
    identity.kind,
    encodeURIComponent(identity.objectName || ""),
  ].join("\u0000");
}
