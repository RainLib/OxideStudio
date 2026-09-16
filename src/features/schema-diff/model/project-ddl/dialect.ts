import { stripSqlComments } from "@/features/schema-diff/model/project-ddl/lexical";
import {
  type ProjectDdlDialect,
  type ProjectDdlDialectDetection,
} from "@/features/schema-diff/model/project-ddl/types";
import type { DatabaseDriver } from "@/services/tauri/types";

export function detectProjectDdlDialect(
  sql: string,
): ProjectDdlDialectDetection {
  const source = stripSqlComments(sql).toUpperCase();
  const candidates: Array<{
    dialect: Exclude<ProjectDdlDialect, "generic">;
    markers: Array<[RegExp, string, number]>;
  }> = [
    {
      dialect: "sqlserver",
      markers: [
        [/^\s*GO\s*$/gim, "GO batch separator", 3],
        [/\[[^\]]+\]\.\[[^\]]+\]/g, "bracket-qualified identifier", 2],
        [/\bIDENTITY\s*\(/g, "IDENTITY column", 3],
        [/\b(?:NVARCHAR|UNIQUEIDENTIFIER|DATETIME2)\b/g, "SQL Server type", 2],
      ],
    },
    {
      dialect: "mysql",
      markers: [
        [/\bAUTO_INCREMENT\b/g, "AUTO_INCREMENT column", 3],
        [/\bENGINE\s*=\s*(?:INNODB|MYISAM)\b/g, "table ENGINE option", 3],
        [/`[^`]+`/g, "backtick identifier", 1],
        [/\bUNSIGNED\b/g, "UNSIGNED type", 1],
      ],
    },
    {
      dialect: "sqlite",
      markers: [
        [/\bPRAGMA\b/g, "PRAGMA statement", 3],
        [
          /\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/g,
          "SQLite autoincrement key",
          3,
        ],
        [/\bWITHOUT\s+ROWID\b/g, "WITHOUT ROWID table", 3],
      ],
    },
    {
      dialect: "oracle",
      markers: [
        [/\bVARCHAR2\s*\(/g, "VARCHAR2 type", 3],
        [/\bNUMBER\s*\([^)]*\)/g, "NUMBER precision", 2],
        [/^\s*\/\s*$/gm, "slash statement terminator", 2],
        [
          /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:PACKAGE|SEQUENCE)\b/g,
          "Oracle schema object",
          2,
        ],
      ],
    },
    {
      dialect: "postgres",
      markers: [
        [/\b(?:BIGSERIAL|SMALLSERIAL|SERIAL|JSONB)\b/g, "PostgreSQL type", 2],
        [/\bCREATE\s+EXTENSION\b/g, "CREATE EXTENSION", 3],
        [/::[A-Z_][A-Z0-9_.]*/g, "PostgreSQL cast", 2],
        [
          /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/g,
          "identity clause",
          2,
        ],
      ],
    },
  ];
  const scored = candidates
    .map(({ dialect, markers }) => {
      let score = 0;
      const evidence: string[] = [];
      for (const [pattern, label, weight] of markers) {
        pattern.lastIndex = 0;
        if (!pattern.test(source)) continue;
        score += weight;
        evidence.push(label);
      }
      return { dialect, evidence, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.dialect.localeCompare(right.dialect),
    );
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score === 0 || best.score === runnerUp?.score) {
    return { dialect: "generic", confidence: "low", evidence: [] };
  }
  return {
    dialect: best.dialect,
    confidence: best.score >= 3 ? "high" : "medium",
    evidence: best.evidence,
  };
}

export function projectDdlDialectForDriver(
  driver: DatabaseDriver,
): ProjectDdlDialect {
  if (driver === "postgres" || driver === "cockroachdb") return "postgres";
  if (driver === "mysql" || driver === "mariadb") return "mysql";
  if (driver === "sqlserver") return "sqlserver";
  if (driver === "sqlite") return "sqlite";
  if (driver === "oracle") return "oracle";
  return "generic";
}
