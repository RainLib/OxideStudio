import {
  looksDestructiveElasticsearchRequest,
  looksReadOnlyElasticsearchRequest,
} from "@/features/query-safety/model/elasticsearchSafety";
import {
  looksDestructiveJsonSearchBody,
  looksReadOnlyJsonSearchBody,
} from "@/features/query-safety/model/jsonSearchSafety";
import {
  looksDestructiveMongoCommand,
  looksReadOnlyMongoCommand,
} from "@/features/query-safety/model/mongoCommandSafety";
import {
  looksDestructiveMongoShell,
  looksLikeMongoShell,
  looksReadOnlyMongoShell,
} from "@/features/query-safety/model/mongoShellSafety";
import {
  looksDestructiveRedisCommands,
  looksReadOnlyRedisCommands,
} from "@/features/query-safety/model/redisSafety";
import {
  containsDangerousSqlFunction,
  containsDestructiveSqlFunction,
} from "@/features/query-safety/model/sqlFunctionPolicy";
import {
  looksDestructiveSqlStatement,
  looksReadOnlySqlStatement,
} from "@/features/query-safety/model/sqlSafety";
import { splitSqlStatements } from "@/features/query-safety/model/sqlScanner";
import type { DatabaseDriver } from "@/services/tauri/types";

export type AiQuerySafety = "read" | "write" | "destructive";

export function classifyAiQuerySafety(
  query: string,
  driver?: DatabaseDriver | null,
): AiQuerySafety {
  if (looksAiQueryReadOnly(query, driver)) return "read";
  if (looksAiQueryDestructive(query, driver)) return "destructive";
  return "write";
}

export function looksAiQueryReadOnly(
  query: string,
  driver?: DatabaseDriver | null,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const normalizedDriver = String(driver || "")
    .trim()
    .toLowerCase();
  if (
    (normalizedDriver === "mongodb" || normalizedDriver === "mongo") &&
    looksLikeMongoShell(query)
  ) {
    return looksReadOnlyMongoShell(query);
  }
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    if (normalizedDriver === "mongodb" || normalizedDriver === "mongo") {
      return looksReadOnlyMongoCommand(query);
    }
    return looksReadOnlyJsonSearchBody(query);
  }

  if (normalizedDriver === "redis") {
    return looksReadOnlyRedisCommands(query);
  }

  if (normalizedDriver === "elasticsearch" || normalizedDriver === "elastic") {
    return looksReadOnlyElasticsearchRequest(query);
  }

  if (containsDangerousSqlFunction(query)) return false;

  const mutatingSqlPrefixes = [
    "alter",
    "call",
    "comment",
    "copy",
    "create",
    "delete",
    "drop",
    "grant",
    "insert",
    "load",
    "lock",
    "merge",
    "replace",
    "revoke",
    "set",
    "truncate",
    "update",
    "vacuum",
  ];

  const statements = splitSqlStatements(query, normalizedDriver);
  if (statements.length !== 1) return false;
  return statements.every((statement) =>
    looksReadOnlySqlStatement(statement, mutatingSqlPrefixes),
  );
}

export function looksAiQueryDestructive(
  query: string,
  driver?: DatabaseDriver | null,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const normalizedDriver = String(driver || "")
    .trim()
    .toLowerCase();
  if (
    (normalizedDriver === "mongodb" || normalizedDriver === "mongo") &&
    looksLikeMongoShell(query)
  ) {
    return looksDestructiveMongoShell(query);
  }
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    if (normalizedDriver === "mongodb" || normalizedDriver === "mongo") {
      return looksDestructiveMongoCommand(query);
    }
    return looksDestructiveJsonSearchBody(query);
  }

  if (normalizedDriver === "redis") {
    return looksDestructiveRedisCommands(query);
  }

  if (normalizedDriver === "elasticsearch" || normalizedDriver === "elastic") {
    return looksDestructiveElasticsearchRequest(query);
  }

  if (containsDestructiveSqlFunction(query)) return true;

  return splitSqlStatements(query, normalizedDriver).some(
    looksDestructiveSqlStatement,
  );
}
