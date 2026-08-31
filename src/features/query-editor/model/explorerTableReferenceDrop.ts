import { quoteIdentifierWithCapabilities } from "@/lib/databaseDialect";

export const OXIDE_TABLE_REFERENCE_MIME =
  "application/x-oxide-table-reference+json";
export const OXIDE_TABLE_REFERENCE_DROP_EVENT =
  "oxide:table-reference-drop";
export const OXIDE_TABLE_REFERENCE_HOVER_EVENT =
  "oxide:table-reference-hover";
export const OXIDE_TABLE_REFERENCE_DRAG_END_EVENT =
  "oxide:table-reference-drag-end";

export const MAX_EXPLORER_TABLE_REFERENCES = 200;

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_IDENTITY_CHARS = 512;
const ALLOWED_IDENTIFIER_QUOTES = new Set(['"', "`", "["]);

export type ExplorerTableReference = {
  schema?: string;
  table: string;
};

export type ExplorerTableReferencePayload = {
  kind: "oxide-table-reference";
  version: 1;
  connectionId: string;
  database?: string;
  identifierQuote: string;
  tables: ExplorerTableReference[];
};

export type ExplorerTableReferenceDropDetail = {
  payload: ExplorerTableReferencePayload;
  clientX: number;
  clientY: number;
};

export type ExplorerTableReferenceHoverDetail = {
  clientX: number;
  clientY: number;
};

function normalizeIdentity(value: unknown, required = false) {
  if (typeof value !== "string") return required ? null : undefined;
  const normalized = value.trim();
  if (
    (!normalized && required) ||
    normalized.length > MAX_IDENTITY_CHARS ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return required ? null : undefined;
  }
  return normalized || undefined;
}

function normalizeTables(value: unknown): ExplorerTableReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tables: ExplorerTableReference[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const table = normalizeIdentity(
      (candidate as Partial<ExplorerTableReference>).table,
      true,
    );
    if (!table) continue;
    const schema = normalizeIdentity(
      (candidate as Partial<ExplorerTableReference>).schema,
    );
    const key = `${schema ?? ""}\u0000${table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tables.push(schema ? { schema, table } : { table });
    if (tables.length >= MAX_EXPLORER_TABLE_REFERENCES) break;
  }
  return tables;
}

export function createExplorerTableReferencePayload(input: {
  connectionId: string;
  database?: string;
  schema?: string;
  tables: readonly string[];
  identifierQuote: string;
}): ExplorerTableReferencePayload | null {
  const connectionId = normalizeIdentity(input.connectionId, true);
  if (!connectionId) return null;
  const database = normalizeIdentity(input.database);
  const schema = normalizeIdentity(input.schema);
  const tables = normalizeTables(
    input.tables.map((table) => ({ schema, table })),
  );
  if (tables.length === 0) return null;
  return {
    kind: "oxide-table-reference",
    version: 1,
    connectionId,
    ...(database ? { database } : {}),
    identifierQuote: ALLOWED_IDENTIFIER_QUOTES.has(input.identifierQuote)
      ? input.identifierQuote
      : '"',
    tables,
  };
}

export function serializeExplorerTableReferencePayload(
  payload: ExplorerTableReferencePayload,
) {
  return JSON.stringify(payload);
}

export function parseExplorerTableReferencePayload(
  raw: string | null | undefined,
): ExplorerTableReferencePayload | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ExplorerTableReferencePayload>;
    if (
      parsed.kind !== "oxide-table-reference" ||
      parsed.version !== 1
    ) {
      return null;
    }
    return parseNormalizedPayload(parsed);
  } catch {
    return null;
  }
}

function parseNormalizedPayload(
  parsed: Partial<ExplorerTableReferencePayload>,
): ExplorerTableReferencePayload | null {
  const connectionId = normalizeIdentity(parsed.connectionId, true);
  const tables = normalizeTables(parsed.tables);
  if (!connectionId || tables.length === 0) return null;
  const database = normalizeIdentity(parsed.database);
  return {
    kind: "oxide-table-reference",
    version: 1,
    connectionId,
    ...(database ? { database } : {}),
    identifierQuote:
      typeof parsed.identifierQuote === "string" &&
      ALLOWED_IDENTIFIER_QUOTES.has(parsed.identifierQuote)
        ? parsed.identifierQuote
        : '"',
    tables,
  };
}

export function explorerTableReferenceInsertText(
  payload: ExplorerTableReferencePayload,
  options?: { includeSchema?: boolean; separator?: string },
) {
  const includeSchema = options?.includeSchema ?? true;
  const separator = options?.separator ?? ", ";
  const capabilities = { identifierQuote: payload.identifierQuote };
  return payload.tables
    .map(({ schema, table }) => {
      const quotedTable = quoteIdentifierWithCapabilities(capabilities, table);
      return includeSchema && schema
        ? `${quoteIdentifierWithCapabilities(capabilities, schema)}.${quotedTable}`
        : quotedTable;
    })
    .join(separator);
}

export function explorerTableReferenceDragLabel(
  payload: ExplorerTableReferencePayload,
) {
  if (payload.tables.length === 1) {
    return explorerTableReferenceInsertText(payload);
  }
  const first = explorerTableReferenceInsertText({
    ...payload,
    tables: payload.tables.slice(0, 1),
  });
  return `${payload.tables.length} tables · ${first} +${payload.tables.length - 1}`;
}

export function hasExplorerTableReferenceType(
  types: Iterable<string> | null | undefined,
) {
  if (!types) return false;
  for (const type of types) {
    if (type === OXIDE_TABLE_REFERENCE_MIME) return true;
  }
  return false;
}

export function explorerTableReferenceDropEvent(
  detail: ExplorerTableReferenceDropDetail,
) {
  return new CustomEvent<ExplorerTableReferenceDropDetail>(
    OXIDE_TABLE_REFERENCE_DROP_EVENT,
    { detail },
  );
}

export function explorerTableReferenceHoverEvent(
  detail: ExplorerTableReferenceHoverDetail,
) {
  return new CustomEvent<ExplorerTableReferenceHoverDetail>(
    OXIDE_TABLE_REFERENCE_HOVER_EVENT,
    { detail },
  );
}
