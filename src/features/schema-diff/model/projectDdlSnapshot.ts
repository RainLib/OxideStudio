import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseDriver,
  IndexInfo,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";

export type ProjectDdlSnapshotIdentity = {
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: DatabaseDriver;
  databaseName?: string | null;
  schemaName: string;
};

export type ProjectDdlParseResult = {
  dialect: ProjectDdlDialect;
  relations: SchemaRelationSnapshot[];
  warnings: string[];
};

export type ProjectDdlDialect =
  | "generic"
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "sqlite"
  | "oracle";

export type ProjectDdlDialectDetection = {
  dialect: ProjectDdlDialect;
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

const OFFLINE_DDL_WARNING = "OFFLINE_PROJECT_DDL_REVIEW_ONLY";
const CONSTRAINT_WORDS = new Set([
  "CONSTRAINT",
  "PRIMARY",
  "UNIQUE",
  "FOREIGN",
  "CHECK",
  "EXCLUDE",
  "KEY",
]);

/**
 * A deliberately bounded DDL reader for project baselines. It understands the
 * portable CREATE TABLE / CREATE INDEX subset, retains unsupported constructs
 * as explicit warnings, and never produces executable SQL. The resulting
 * snapshot is review-only until a dialect-owned parser can establish a fully
 * verified source fingerprint.
 */
export function parseProjectDdl(
  sql: string,
  fallbackSchema: string,
  preferredDialect: ProjectDdlDialect = "generic",
): ProjectDdlParseResult {
  const warnings = new Set<string>();
  const detectedDialect = detectProjectDdlDialect(sql);
  const dialect = detectedDialect.dialect === "generic"
    ? preferredDialect
    : detectedDialect.dialect;
  if (
    preferredDialect !== "generic" &&
    detectedDialect.confidence === "high" &&
    detectedDialect.dialect !== "generic" &&
    detectedDialect.dialect !== preferredDialect
  ) {
    warnings.add(
      `DDL markers indicate ${detectedDialect.dialect}, but the current connection uses ${preferredDialect}; parsed as detected source syntax for review.`,
    );
  }
  const relations = new Map<string, SchemaRelationSnapshot>();
  const pendingIndexes: Array<{ table: string; index: IndexInfo }> = [];
  const pendingConstraints: Array<{ table: string; constraint: ConstraintInfo }> = [];

  for (const statement of splitStatements(stripSqlComments(sql), dialect)) {
    const trimmed = statement.trim();
    if (!trimmed) continue;
    const table = parseCreateTable(trimmed, fallbackSchema, warnings);
    if (table) {
      if (relations.has(table.name)) {
        warnings.add(`Duplicate CREATE TABLE for ${table.name}; the later definition was ignored.`);
      } else {
        relations.set(table.name, table);
      }
      continue;
    }
    const alteredConstraint = parseAlterTableConstraint(trimmed, fallbackSchema, warnings);
    if (alteredConstraint) {
      pendingConstraints.push(alteredConstraint);
      continue;
    }
    const index = parseCreateIndex(trimmed, fallbackSchema);
    if (index) {
      pendingIndexes.push(index);
      continue;
    }
    if (/^CREATE\b/i.test(trimmed)) {
      warnings.add(`Unsupported CREATE statement was ignored: ${leadingWords(trimmed)}.`);
    }
  }

  for (const { table, constraint } of pendingConstraints) {
    const relation = relations.get(table);
    if (!relation) {
      warnings.add(
        `ALTER TABLE constraint refers to ${table}, which was not found in this DDL source.`,
      );
      continue;
    }
    attachConstraint(relation, constraint);
  }

  for (const { table, index } of pendingIndexes) {
    const relation = relations.get(table);
    if (!relation) {
      warnings.add(`Index ${index.name} refers to table ${table}, which was not found in this DDL source.`);
      continue;
    }
    relation.indexes.push(index);
    for (const column of relation.columns) {
      if (index.columns.includes(column.name)) column.is_indexed = true;
    }
  }

  if (relations.size === 0) {
    warnings.add("No supported CREATE TABLE statement was found in this project SQL file.");
  }
  return {
    dialect,
    relations: [...relations.values()].sort((left, right) => left.name.localeCompare(right.name)),
    warnings: [...warnings].sort(),
  };
}

export function detectProjectDdlDialect(sql: string): ProjectDdlDialectDetection {
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
        [/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/g, "SQLite autoincrement key", 3],
        [/\bWITHOUT\s+ROWID\b/g, "WITHOUT ROWID table", 3],
      ],
    },
    {
      dialect: "oracle",
      markers: [
        [/\bVARCHAR2\s*\(/g, "VARCHAR2 type", 3],
        [/\bNUMBER\s*\([^)]*\)/g, "NUMBER precision", 2],
        [/^\s*\/\s*$/gm, "slash statement terminator", 2],
        [/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:PACKAGE|SEQUENCE)\b/g, "Oracle schema object", 2],
      ],
    },
    {
      dialect: "postgres",
      markers: [
        [/\b(?:BIGSERIAL|SMALLSERIAL|SERIAL|JSONB)\b/g, "PostgreSQL type", 2],
        [/\bCREATE\s+EXTENSION\b/g, "CREATE EXTENSION", 3],
        [/::[A-Z_][A-Z0-9_.]*/g, "PostgreSQL cast", 2],
        [/\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/g, "identity clause", 2],
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
    .sort((left, right) => right.score - left.score || left.dialect.localeCompare(right.dialect));
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

export function createProjectDdlSnapshot(
  identity: ProjectDdlSnapshotIdentity,
  relativePath: string | readonly string[],
  sql: string,
  capturedAt = Date.now(),
): SchemaSnapshot {
  const sourcePaths = Array.from(
    new Set(
      (Array.isArray(relativePath) ? relativePath : [relativePath])
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const parsed = parseProjectDdl(
    sql,
    identity.schemaName,
    projectDdlDialectForDriver(identity.driver),
  );
  const fingerprint = stableSnapshotFingerprint(identity, sourcePaths, parsed.relations);
  return {
    version: 1,
    id: `project-ddl-${capturedAt}-${fingerprint.slice(0, 12)}`,
    fingerprint,
    projectId: identity.projectId,
    connectionId: identity.connectionId,
    connectionName: identity.connectionName,
    driver: identity.driver,
    databaseName: identity.databaseName || null,
    schemaName: identity.schemaName,
    capturedAt,
    relations: parsed.relations,
    warnings: [
      OFFLINE_DDL_WARNING,
      ...sourcePaths.map((path) => `Source: ${path}`),
      `DDL dialect: ${parsed.dialect}`,
      ...parsed.warnings,
    ],
  };
}

export function isProjectDdlSnapshot(snapshot: SchemaSnapshot) {
  return snapshot.warnings.includes(OFFLINE_DDL_WARNING);
}

export function projectDdlSnapshotSources(snapshot: SchemaSnapshot) {
  return snapshot.warnings
    .filter((warning) => warning.startsWith("Source: "))
    .map((warning) => warning.slice("Source: ".length));
}

function parseCreateTable(
  statement: string,
  fallbackSchema: string,
  warnings: Set<string>,
): SchemaRelationSnapshot | null {
  const match = statement.match(/^CREATE\s+(?:TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i);
  if (!match) return null;
  const rest = statement.slice(match[0].length).trimStart();
  const opening = rest.indexOf("(");
  if (opening < 0) {
    warnings.add(`CREATE TABLE without a column list was ignored: ${leadingWords(statement)}.`);
    return null;
  }
  const close = matchingParen(rest, opening);
  if (close < 0) {
    warnings.add(`CREATE TABLE has unbalanced parentheses: ${leadingWords(statement)}.`);
    return null;
  }
  const tableName = normalizeRelationName(rest.slice(0, opening), fallbackSchema);
  if (!tableName) {
    warnings.add("CREATE TABLE has an unsupported identifier.");
    return null;
  }

  const columns: ColumnInfo[] = [];
  const indexes: IndexInfo[] = [];
  const constraints: ConstraintInfo[] = [];
  for (const item of splitTopLevel(rest.slice(opening + 1, close), ",")) {
    const entry = item.trim();
    if (!entry) continue;
    const tableIndex = parseCreateTableIndex(entry, tableName);
    if (tableIndex) {
      indexes.push(tableIndex);
      if (tableIndex.is_unique) {
        constraints.push({
          name: tableIndex.name,
          constraint_type: "UNIQUE",
          columns: tableIndex.columns,
          referenced_columns: [],
        });
      }
      continue;
    }
    const constraint = parseConstraint(entry, tableName, warnings);
    if (constraint) {
      constraints.push(constraint);
      if (constraint.constraint_type === "PRIMARY KEY") {
        indexes.push({ name: constraint.name, columns: constraint.columns, is_unique: true, is_primary: true });
      }
      continue;
    }
    const column = parseColumn(entry, warnings);
    if (!column) continue;
    columns.push(column);
    const inlineReference = parseInlineReference(entry, tableName, column.name);
    if (inlineReference) constraints.push(inlineReference);
    if (column.is_primary_key) {
      const name = `${tableName.replace(/\./g, "_")}_pkey`;
      constraints.push({ name, constraint_type: "PRIMARY KEY", columns: [column.name], referenced_columns: [] });
      indexes.push({ name, columns: [column.name], is_unique: true, is_primary: true });
    } else if (column.is_unique) {
      constraints.push({ name: `${tableName.replace(/\./g, "_")}_${column.name}_key`, constraint_type: "UNIQUE", columns: [column.name], referenced_columns: [] });
    }
  }
  const primaryColumns = new Set(constraints.filter((item) => item.constraint_type === "PRIMARY KEY").flatMap((item) => item.columns));
  const uniqueColumns = new Set(constraints.filter((item) => item.constraint_type === "UNIQUE").flatMap((item) => item.columns));
  const indexedColumns = new Set(indexes.flatMap((item) => item.columns));
  for (const column of columns) {
    column.is_primary_key ||= primaryColumns.has(column.name);
    column.is_unique ||= uniqueColumns.has(column.name);
    column.is_indexed ||= column.is_primary_key || column.is_unique || indexedColumns.has(column.name);
  }
  return { name: tableName, objectType: "BASE TABLE", columns, indexes, constraints };
}

function parseCreateIndex(statement: string, fallbackSchema: string) {
  const match = statement.match(
    /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s+ON\s+([^\s(]+)\s*/i,
  );
  if (!match) return null;
  const table = normalizeRelationName(match[3] || "", fallbackSchema);
  const name = normalizeIdentifier(match[2] || "");
  const columnGroup = parenthesizedContent(statement.slice(match[0].length));
  const columns = indexColumnList(columnGroup?.content || "");
  if (!table || !name || columns.length === 0) return null;
  return { table, index: { name, columns, is_unique: Boolean(match[1]), is_primary: false } };
}

function parseCreateTableIndex(entry: string, table: string): IndexInfo | null {
  const header = entry.match(
    /^(UNIQUE\s+)?(?:(FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\s+([^\s(]+)\s*(?:USING\s+([A-Za-z0-9_]+)\s*)?/i,
  );
  if (!header) return null;
  const columnGroup = parenthesizedContent(entry.slice(header[0].length));
  const name = normalizeIdentifier(header[3] || "");
  const columns = indexColumnList(columnGroup?.content || "");
  if (!name || columns.length === 0) return null;
  const trailingType = columnGroup?.trailing.match(/^\s*USING\s+([A-Za-z0-9_]+)/i)?.[1];
  const indexType = header[2] || header[4] || trailingType;
  return {
    name,
    columns,
    is_unique: Boolean(header[1]),
    is_primary: false,
    index_type: indexType?.toUpperCase(),
    definition: `${table}: ${entry.trim()}`,
  };
}

function parseAlterTableConstraint(
  statement: string,
  fallbackSchema: string,
  warnings: Set<string>,
) {
  const match = statement.match(
    /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s]+)\s+ADD\s+(.+)$/is,
  );
  if (!match) return null;
  const table = normalizeRelationName(match[1] || "", fallbackSchema);
  if (!table) {
    warnings.add(`ALTER TABLE has an unsupported identifier: ${leadingWords(statement)}.`);
    return null;
  }
  const constraint = parseConstraint(match[2] || "", table, warnings);
  if (!constraint) {
    warnings.add(`Unsupported ALTER TABLE clause was ignored: ${leadingWords(statement)}.`);
    return null;
  }
  return { table, constraint };
}

function attachConstraint(relation: SchemaRelationSnapshot, constraint: ConstraintInfo) {
  if (
    relation.constraints.some(
      (candidate) =>
        candidate.name === constraint.name ||
        (candidate.constraint_type === constraint.constraint_type &&
          candidate.columns.join("\u0000") === constraint.columns.join("\u0000")),
    )
  ) {
    return;
  }
  relation.constraints.push(constraint);
  if (constraint.constraint_type === "PRIMARY KEY") {
    relation.indexes.push({
      name: constraint.name,
      columns: constraint.columns,
      is_unique: true,
      is_primary: true,
    });
  }
  for (const column of relation.columns) {
    if (constraint.constraint_type === "PRIMARY KEY" && constraint.columns.includes(column.name)) {
      column.is_primary_key = true;
      column.is_unique = true;
      column.is_indexed = true;
    }
    if (constraint.constraint_type === "UNIQUE" && constraint.columns.includes(column.name)) {
      column.is_unique = true;
      column.is_indexed = true;
    }
  }
}

function parseConstraint(entry: string, table: string, warnings: Set<string>): ConstraintInfo | null {
  const value = entry.replace(/^CONSTRAINT\s+([^\s]+)\s+/i, "");
  const named = entry.match(/^CONSTRAINT\s+([^\s]+)\s+/i)?.[1];
  const name = normalizeIdentifier(named || "") || `${table.replace(/\./g, "_")}_constraint`;
  const primary = value.match(/^PRIMARY\s+KEY\s*\(([^)]*)\)/i);
  if (primary) return { name, constraint_type: "PRIMARY KEY", columns: columnList(primary[1] || ""), referenced_columns: [] };
  const unique = value.match(/^UNIQUE\s*(?:KEY\s*)?\(([^)]*)\)/i);
  if (unique) return { name, constraint_type: "UNIQUE", columns: columnList(unique[1] || ""), referenced_columns: [] };
  const foreign = value.match(/^FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i);
  if (foreign) {
    const reference = normalizeReferencedRelation(foreign[2] || "");
    const [referencedSchema, referencedTable] = reference?.includes(".")
      ? reference.split(/\.(?=[^.]+$)/)
      : [undefined, reference];
    return { name, constraint_type: "FOREIGN KEY", columns: columnList(foreign[1] || ""), referenced_schema: referencedSchema, referenced_table: referencedTable || undefined, referenced_columns: columnList(foreign[3] || "") };
  }
  if (/^(CHECK|EXCLUDE)\b/i.test(value)) warnings.add(`Unsupported constraint preserved as review warning on ${table}.`);
  return null;
}

function parseInlineReference(
  entry: string,
  table: string,
  column: string,
): ConstraintInfo | null {
  const foreign = entry.match(
    /(?:CONSTRAINT\s+([^\s]+)\s+)?REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i,
  );
  if (!foreign) return null;
  const reference = normalizeReferencedRelation(foreign[2] || "");
  if (!reference) return null;
  const [referencedSchema, referencedTable] = reference.includes(".")
    ? reference.split(/\.(?=[^.]+$)/)
    : [undefined, reference];
  const explicitName = normalizeIdentifier(foreign[1] || "");
  return {
    name: explicitName || `${table.replace(/\./g, "_")}_${column}_fkey`,
    constraint_type: "FOREIGN KEY",
    columns: [column],
    referenced_schema: referencedSchema,
    referenced_table: referencedTable || undefined,
    referenced_columns: columnList(foreign[3] || ""),
    definition: entry.trim(),
  };
}

function parseColumn(entry: string, warnings: Set<string>): ColumnInfo | null {
  const parts = entry.match(/^([^\s]+)\s+(.+)$/s);
  if (!parts) {
    warnings.add(`Unsupported table item was ignored: ${leadingWords(entry)}.`);
    return null;
  }
  const name = normalizeIdentifier(parts[1] || "");
  if (!name || CONSTRAINT_WORDS.has(name.toUpperCase())) return null;
  const definition = parts[2] || "";
  const type = definition.match(
    /^(.+?)(?=\s+(?:DEFAULT|NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED|IDENTITY|AUTO_INCREMENT|AUTOINCREMENT|CONSTRAINT)\b|$)/is,
  )?.[1]?.trim();
  if (!type) {
    warnings.add(`Column ${name} has no supported type and was ignored.`);
    return null;
  }
  const defaultValue = definition.match(
    /\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|COLLATE|GENERATED|IDENTITY|AUTO_INCREMENT|AUTOINCREMENT|CONSTRAINT)\b|$)/i,
  )?.[1]?.trim();
  return {
    name,
    data_type: type,
    is_nullable: !/\bNOT\s+NULL\b/i.test(definition) && !/\bPRIMARY\s+KEY\b/i.test(definition),
    is_primary_key: /\bPRIMARY\s+KEY\b/i.test(definition),
    is_unique: /\bUNIQUE\b/i.test(definition),
    is_auto_increment: /\b(?:AUTO_INCREMENT|AUTOINCREMENT|SERIAL|IDENTITY)\b/i.test(definition),
    default_value: defaultValue,
  };
}

function normalizeRelationName(value: string, fallbackSchema: string) {
  const segments = value.trim().split(".").map(normalizeIdentifier).filter(Boolean);
  if (segments.length === 1) return segments[0];
  if (
    segments.length === 2 &&
    (!fallbackSchema || segments[0] === normalizeIdentifier(fallbackSchema))
  ) {
    return segments[1];
  }
  return null;
}

function projectDdlDialectForDriver(driver: DatabaseDriver): ProjectDdlDialect {
  if (driver === "postgres" || driver === "cockroachdb") return "postgres";
  if (driver === "mysql" || driver === "mariadb") return "mysql";
  if (driver === "sqlserver") return "sqlserver";
  if (driver === "sqlite") return "sqlite";
  if (driver === "oracle") return "oracle";
  return "generic";
}

function normalizeReferencedRelation(value: string) {
  const segments = value.trim().split(".").map(normalizeIdentifier).filter(Boolean);
  if (segments.length === 1 || segments.length === 2) return segments.join(".");
  return null;
}

function normalizeIdentifier(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const quoted = trimmed.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))$/);
  return (quoted?.[1] || quoted?.[2] || quoted?.[3] || quoted?.[4] || "").trim();
}

function columnList(value: string) {
  return splitTopLevel(value, ",").map(normalizeIdentifier).filter(Boolean);
}

function indexColumnList(value: string) {
  return splitTopLevel(value, ",")
    .map((column) => column.trim().replace(/\s+(?:ASC|DESC)\b.*$/i, ""))
    .map((column) => column.replace(/\(\s*\d+\s*\)$/, ""))
    .map(normalizeIdentifier)
    .filter(Boolean);
}

function parenthesizedContent(value: string) {
  const opening = value.indexOf("(");
  if (opening < 0) return null;
  const close = matchingParen(value, opening);
  if (close < 0) return null;
  return {
    content: value.slice(opening + 1, close),
    trailing: value.slice(close + 1),
  };
}

function splitStatements(sql: string, dialect: ProjectDdlDialect) {
  const normalized = dialect === "sqlserver"
    ? sql.replace(/^\s*GO\s*$/gim, ";")
    : dialect === "oracle"
      ? sql.replace(/^\s*\/\s*$/gm, ";")
      : sql;
  return splitTopLevel(normalized, ";");
}

function splitTopLevel(value: string, delimiter: string) {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] || "";
    if (dollarQuote) {
      if (value.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      if (char === "]" && value[index + 1] === "]") {
        index += 1;
      } else if (char === "]") {
        bracketQuote = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote && value[index + 1] === quote) {
        index += 1;
      } else if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function matchingParen(value: string, opening: number) {
  let depth = 0;
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;
  for (let index = opening; index < value.length; index += 1) {
    const char = value[index] || "";
    if (dollarQuote) {
      if (value.startsWith(dollarQuote, index)) {
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      if (char === "]" && value[index + 1] === "]") {
        index += 1;
      } else if (char === "]") {
        bracketQuote = false;
      }
      continue;
    }
    if (quote) {
      if (char === quote && value[index + 1] === quote) {
        index += 1;
      } else if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      index += tag.length - 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function stripSqlComments(value: string) {
  let result = "";
  let quote = "";
  let dollarQuote = "";
  let bracketQuote = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] || "";
    const next = value[index + 1] || "";
    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        result += char;
      } else {
        result += " ";
      }
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        result += "  ";
        index += 1;
      } else if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        result += "  ";
        index += 1;
      } else {
        result += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }
    if (dollarQuote) {
      result += char;
      if (value.startsWith(dollarQuote, index)) {
        result += value.slice(index + 1, index + dollarQuote.length);
        index += dollarQuote.length - 1;
        dollarQuote = "";
      }
      continue;
    }
    if (bracketQuote) {
      result += char;
      if (char === "]" && next === "]") {
        result += next;
        index += 1;
      } else if (char === "]") {
        bracketQuote = false;
      }
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote && next === quote) {
        result += next;
        index += 1;
      } else if (char === quote && value[index - 1] !== "\\") {
        quote = "";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockCommentDepth = 1;
      result += "  ";
      index += 1;
      continue;
    }
    if (["'", '"', "`"].includes(char)) {
      quote = char;
      result += char;
      continue;
    }
    if (char === "[") {
      bracketQuote = true;
      result += char;
      continue;
    }
    const tag = char === "$" ? readDollarQuoteTag(value, index) : "";
    if (tag) {
      dollarQuote = tag;
      result += tag;
      index += tag.length - 1;
      continue;
    }
    result += char;
  }
  return result;
}

function readDollarQuoteTag(value: string, start: number) {
  return value.slice(start).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0] || "";
}

function leadingWords(value: string) {
  return value.replace(/\s+/g, " ").trim().split(" ").slice(0, 5).join(" ");
}

function stableSnapshotFingerprint(
  identity: ProjectDdlSnapshotIdentity,
  paths: readonly string[],
  relations: SchemaRelationSnapshot[],
) {
  const input = JSON.stringify([
    identity.driver,
    identity.databaseName || null,
    identity.schemaName,
    paths,
    relations,
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `offline-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
