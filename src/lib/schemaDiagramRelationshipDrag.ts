const SCHEMA_COLUMN_DRAG_MIME = "application/x-oxide-schema-column";
const MAX_SCHEMA_COLUMN_DRAG_BYTES = 1_024;

export type SchemaDiagramColumnEndpoint = {
  relationName: string;
  columnName: string;
};

export function writeSchemaDiagramColumnDrag(
  dataTransfer: DataTransfer,
  endpoint: SchemaDiagramColumnEndpoint,
) {
  const payload = JSON.stringify(endpoint);
  dataTransfer.effectAllowed = "link";
  dataTransfer.setData(SCHEMA_COLUMN_DRAG_MIME, payload);
}

export function readSchemaDiagramColumnDrag(dataTransfer: DataTransfer) {
  const payload = dataTransfer.getData(SCHEMA_COLUMN_DRAG_MIME);
  return parseSchemaDiagramColumnDrag(payload);
}

export function parseSchemaDiagramColumnDrag(
  payload: string,
): SchemaDiagramColumnEndpoint | null {
  if (!payload || payload.length > MAX_SCHEMA_COLUMN_DRAG_BYTES) return null;
  try {
    const value = JSON.parse(payload) as Partial<SchemaDiagramColumnEndpoint>;
    const relationName = normalizedName(value.relationName);
    const columnName = normalizedName(value.columnName);
    return relationName && columnName ? { relationName, columnName } : null;
  } catch {
    return null;
  }
}

export function suggestedSchemaDiagramForeignKeyName(
  existingNames: Iterable<string>,
  source: SchemaDiagramColumnEndpoint,
) {
  const existing = new Set(existingNames);
  const base = `${source.relationName}_${source.columnName}_fk`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizedName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && !normalized.includes("\u0000") ? normalized : null;
}
