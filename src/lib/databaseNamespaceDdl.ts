import type { DatabaseDriver } from "@/services/tauri/types";
import { quoteIdentifier } from "@/lib/databaseDialect";

export interface CreateNamespaceDdlOptions {
  driver: DatabaseDriver;
  name: string;
  owner?: string;
  charset?: string;
  collation?: string;
}

export const MONGODB_DATABASE_INITIALIZATION_COLLECTION = "oxide_init";

function safeSqlToken(value: string | undefined) {
  const normalized = value?.trim() || "";
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : "";
}

export function createNamespaceDdl(options: CreateNamespaceDdlOptions) {
  const name = options.name.trim();
  if (!name) return "-- Enter a name to preview the generated statement.";

  if (options.driver === "postgres") {
    const owner = options.owner?.trim();
    return `CREATE SCHEMA ${quoteIdentifier("postgres", name)}${
      owner ? ` AUTHORIZATION ${quoteIdentifier("postgres", owner)}` : ""
    };`;
  }

  if (options.driver === "mysql") {
    const charset = safeSqlToken(options.charset);
    const collation = safeSqlToken(options.collation);
    return `CREATE DATABASE ${quoteIdentifier("mysql", name)}${
      charset ? `\n  CHARACTER SET ${charset}` : ""
    }${collation ? `\n  COLLATE ${collation}` : ""};`;
  }

  return `-- ${String(options.driver)} does not support namespace creation.`;
}

export function mongoCreateDatabasePreview(name: string) {
  const database = name.trim();
  if (!database) return "// Enter a database name to preview the MongoDB command.";
  return JSON.stringify(
    {
      database,
      command: { create: MONGODB_DATABASE_INITIALIZATION_COLLECTION },
    },
    null,
    2,
  );
}
