import { databaseDriverProfile } from "@/features/database-drivers/model/runtimeCatalog";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";

function quoteIdentifierWithDelimiter(quote: string, identifier: string) {
  // The runtime driver contract intentionally stores one identifier quote value.
  // Square brackets are the only asymmetric dialect delimiter we accept, so keep
  // its closing delimiter and escaping rules here instead of generating `[name[`.
  if (quote === "[") {
    return "[" + identifier.split("]").join("]]") + "]";
  }

  return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`;
}

export function quoteIdentifier(driver: DatabaseDriver, identifier: string) {
  const quote = databaseDriverProfile(driver).capabilities.identifierQuote;
  return quoteIdentifierWithDelimiter(quote, identifier);
}

export function quoteIdentifierWithCapabilities(
  capabilities: Pick<DatabaseCapabilities, "identifierQuote">,
  identifier: string,
) {
  const quote = capabilities.identifierQuote || '"';
  return quoteIdentifierWithDelimiter(quote, identifier);
}

export function qualifiedTableName(
  driver: DatabaseDriver,
  schema: string | null | undefined,
  table: string,
) {
  if (!schema) return quoteIdentifier(driver, table);
  return `${quoteIdentifier(driver, schema)}.${quoteIdentifier(driver, table)}`;
}

export function previewTableQuery(
  driver: DatabaseDriver,
  schema: string | null | undefined,
  table: string,
  limit = 500,
) {
  return `SELECT * FROM ${qualifiedTableName(driver, schema, table)} LIMIT ${limit};`;
}

export function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}
