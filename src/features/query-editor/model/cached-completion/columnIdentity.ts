import { unquoteIdentifier } from "./lexical";
/** Matching a referenced column differs from fuzzy completion-name search. */
export function cachedColumnMatches(name: string, sql: string, driver: string) {
  const value = unquoteIdentifier(sql);
  if (/^["`[]/u.test(sql)) return name === value;
  if (["postgres", "postgresql", "cockroachdb", "yugabytedb", "neon", "supabase", "timescaledb"].includes(driver)) return name === value.toLowerCase();
  if (driver === "oracle") return name === value.toUpperCase();
  if (driver === "clickhouse") return name === value;
  return name.toLowerCase() === value.toLowerCase();
}
