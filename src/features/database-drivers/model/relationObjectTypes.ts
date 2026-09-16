export function normalizeRelationObjectType(objectType?: string | null) {
  return (objectType || "").trim().toUpperCase();
}

export function isViewObject(objectType?: string | null) {
  return normalizeRelationObjectType(objectType).includes("VIEW");
}

export function isMaterializedViewObject(objectType?: string | null) {
  const normalized = normalizeRelationObjectType(objectType);
  return normalized.includes("MATERIALIZED") && normalized.includes("VIEW");
}

export function isForeignTableObject(objectType?: string | null) {
  return normalizeRelationObjectType(objectType).includes("FOREIGN TABLE");
}

export function isReadOnlyRelationObject(objectType?: string | null) {
  return isViewObject(objectType) || isForeignTableObject(objectType);
}

export function canManageRelationIndexes(objectType?: string | null) {
  return (
    !isForeignTableObject(objectType) &&
    (!isViewObject(objectType) || isMaterializedViewObject(objectType))
  );
}

export function canAlterRelationStructure(objectType?: string | null) {
  return !isReadOnlyRelationObject(objectType);
}

export function relationObjectLabel(objectType?: string | null) {
  if (isMaterializedViewObject(objectType)) return "Materialized View";
  if (isViewObject(objectType)) return "View";
  if (isForeignTableObject(objectType)) return "Foreign Table";
  return "Table";
}
