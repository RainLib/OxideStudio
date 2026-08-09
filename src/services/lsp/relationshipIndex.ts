import type { LspTableDefinition } from "./schemaConfig";

export type LspRelationshipScope = {
  connectionId: string;
  driver: string;
  databaseName?: string;
  schema: string;
};

export type LspForeignKeyRelationship = {
  name: string;
  ownerSchema: string;
  ownerTable: string;
  ownerColumns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
};

const relationshipsByScope = new Map<string, LspForeignKeyRelationship[]>();

function normalize(value: string | undefined) {
  return value?.trim().toLocaleLowerCase() || "";
}

function scopeKey(scope: LspRelationshipScope) {
  return [
    scope.connectionId,
    normalize(scope.driver),
    normalize(scope.databaseName),
    normalize(scope.schema),
  ].join("\u0000");
}

function isForeignKey(value: string) {
  return /foreign\s+key|^fk$/iu.test(value.trim());
}

/**
 * Publishes the relationship subset of an already-loaded semantic catalog.
 * This adds no database requests: it reuses the same bounded metadata batches
 * that feed the SQL language service.
 */
export function replaceLspRelationshipIndex(
  scope: LspRelationshipScope,
  tables: readonly LspTableDefinition[],
) {
  const relationships = tables.flatMap((table) =>
    table.constraints
      .filter(
        (constraint) =>
          isForeignKey(constraint.constraint_type) &&
          Boolean(constraint.referenced_table) &&
          constraint.columns.length > 0 &&
          constraint.columns.length === constraint.referenced_columns.length,
      )
      .map((constraint) => ({
        name: constraint.name,
        ownerSchema: scope.schema,
        ownerTable: table.name,
        ownerColumns: [...constraint.columns],
        referencedSchema: constraint.referenced_schema || scope.schema,
        referencedTable: constraint.referenced_table!,
        referencedColumns: [...constraint.referenced_columns],
      })),
  );
  relationshipsByScope.set(scopeKey(scope), relationships);
}

export function lspForeignKeyRelationships(scope: LspRelationshipScope) {
  return relationshipsByScope.get(scopeKey(scope)) || [];
}

export function clearLspRelationshipIndex(connectionId?: string) {
  if (!connectionId) {
    relationshipsByScope.clear();
    return;
  }
  const prefix = `${connectionId}\u0000`;
  for (const key of relationshipsByScope.keys()) {
    if (key.startsWith(prefix)) relationshipsByScope.delete(key);
  }
}
