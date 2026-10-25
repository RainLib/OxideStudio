import type { LspSchemaDefinition } from "./types";

export function lspSchemaSignature(schemaDefinitions: LspSchemaDefinition[]) {
  const canonicalSchemas = schemaDefinitions
    .map((schema) => ({
      id: schema.id,
      server: schema.server ?? null,
      namespace: schema.namespace ? {
        default_schema: schema.namespace.default_schema,
        tables_complete: schema.namespace.tables_complete ?? false,
      } : null,
      catalog: schema.catalog ?? null,
      database: schema.database,
      driver: schema.driver ?? null,
      server_version: schema.server_version ?? null,
      snapshot_revision: schema.snapshot_revision ?? null,
      source_uri: schema.source_uri ?? null,
      tables: sortCanonical(
        schema.tables.map((table) => ({
          name: table.name,
          object_type: table.object_type ?? null,
          comment: table.comment ?? null,
          source_location: table.source_location ?? null,
          columns: sortCanonical(
            table.columns.map((column) => ({
              name: column.name,
              data_type: column.data_type,
              nullable: column.nullable,
              primary_key: column.primary_key,
              unique: column.unique,
              indexed: column.indexed,
              default_value: column.default_value ?? null,
              auto_increment: column.auto_increment ?? false,
              generated: column.generated ?? false,
              hidden: column.hidden ?? false,
              comment: column.comment ?? null,
              source_location: column.source_location ?? null,
            })),
          ),
          indexes: sortCanonical(
            table.indexes.map((index) => ({
              name: index.name,
              columns: [...index.columns],
              is_unique: index.is_unique,
              is_primary: index.is_primary,
              index_type: index.index_type ?? null,
              definition: index.definition ?? null,
            })),
          ),
          constraints: sortCanonical(
            table.constraints.map((constraint) => ({
              name: constraint.name,
              constraint_type: constraint.constraint_type,
              columns: [...constraint.columns],
              referenced_schema: constraint.referenced_schema ?? null,
              referenced_table: constraint.referenced_table ?? null,
              referenced_columns: [...constraint.referenced_columns],
              definition: constraint.definition ?? null,
            })),
          ),
        })),
      ),
      functions: sortCanonical(
        schema.functions.map((fn) => ({
          name: fn.name,
          routine_type: fn.routine_type ?? null,
          return_type: fn.return_type,
          description: fn.description ?? null,
          parameters: fn.parameters.map((parameter, position) => ({
            position,
            name: parameter.name,
            data_type: parameter.data_type,
            optional: parameter.optional,
            mode: parameter.mode ?? null,
          })),
        })),
      ),
    }))
    .sort(compareCanonical);

  return JSON.stringify(canonicalSchemas);
}

function sortCanonical<T>(values: T[]) {
  return values.sort(compareCanonical);
}

function compareCanonical(left: unknown, right: unknown) {
  const leftSignature = JSON.stringify(left);
  const rightSignature = JSON.stringify(right);
  if (leftSignature < rightSignature) return -1;
  if (leftSignature > rightSignature) return 1;
  return 0;
}
