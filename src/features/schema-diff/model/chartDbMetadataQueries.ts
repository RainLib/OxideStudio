import type { DatabaseDriver } from "@/services/tauri/types";

export type ChartDbMetadataQuery = {
  dialectLabel: string;
  query: string;
  note: string;
};

/**
 * Produces a target-scoped metadata query whose single
 * `metadata_json_to_import` cell matches ChartDB's import contract. Keeping
 * the query local makes offline capture possible without bundling credentials
 * or sending catalog metadata through a third-party service.
 */
export function chartDbMetadataQueryForDriver(
  driver: DatabaseDriver,
  schemaName: string,
  databaseName?: string | null,
): ChartDbMetadataQuery | null {
  const normalized = driver.trim().toLowerCase().replace(/[\s_-]+/gu, "");
  const schema = schemaName.trim();
  if (["postgres", "postgresql", "supabase", "timescaledb", "cockroachdb"].includes(normalized)) {
    return {
      dialectLabel: normalized === "cockroachdb" ? "CockroachDB" : "PostgreSQL",
      query: postgresMetadataQuery(schema || "public"),
      note: "Runs read-only catalog queries and returns one ChartDB-compatible JSON cell.",
    };
  }
  if (["mysql", "mariadb", "tidb", "singlestore"].includes(normalized)) {
    return {
      dialectLabel: normalized === "mariadb" ? "MariaDB 10.5+" : "MySQL 8+",
      query: mysqlMetadataQuery(schema || databaseName || ""),
      note: "Requires JSON_ARRAYAGG support and reads only information_schema metadata.",
    };
  }
  if (["sqlite", "sqlite3", "libsql", "turso", "cloudflared1", "d1"].includes(normalized)) {
    return {
      dialectLabel: "SQLite JSON1",
      query: sqliteMetadataQuery(),
      note: "Uses sqlite_schema and PRAGMA table-valued functions; no table data is read.",
    };
  }
  if (["sqlserver", "mssql", "azuresql", "microsoftsqlserver"].includes(normalized)) {
    return {
      dialectLabel: "SQL Server 2017+",
      query: sqlServerMetadataQuery(schema || "dbo"),
      note: "Uses FOR JSON PATH against sys and INFORMATION_SCHEMA catalogs.",
    };
  }
  if (normalized === "clickhouse") {
    return {
      dialectLabel: "ClickHouse",
      query: clickHouseMetadataQuery(databaseName || schema || "default"),
      note: "Captures tables and columns from system catalogs; unsupported constraints remain empty.",
    };
  }
  if (["oracle", "oracledb"].includes(normalized)) {
    return {
      dialectLabel: "Oracle 19c+",
      query: oracleMetadataQuery(schema),
      note: "Uses SQL/JSON catalog aggregation; the connected user needs catalog visibility for the target owner.",
    };
  }
  return null;
}

function postgresMetadataQuery(schema: string) {
  const target = sqlLiteral(schema);
  return `/* OxideStudio / ChartDB-compatible metadata capture: PostgreSQL */
WITH tables_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname,
    'type', CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'BASE TABLE' END
  ) ORDER BY c.relname), '[]'::jsonb) AS value
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${target} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), columns_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname, 'name', a.attname,
    'type', format_type(a.atttypid, a.atttypmod), 'ordinal_position', a.attnum,
    'nullable', NOT a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
    'is_identity', a.attidentity <> '', 'comment', col_description(c.oid, a.attnum)
  ) ORDER BY c.relname, a.attnum), '[]'::jsonb) AS value
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE n.nspname = ${target} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0 AND NOT a.attisdropped
), pk_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname, 'column', a.attname,
    'pk_def', pg_get_constraintdef(con.oid)
  ) ORDER BY c.relname, key.ordinality), '[]'::jsonb) AS value
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = key.attnum
  WHERE n.nspname = ${target} AND con.contype = 'p'
), fk_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', ns.nspname, 'table', src.relname, 'column', src_col.attname,
    'foreign_key_name', con.conname, 'reference_schema', nr.nspname,
    'reference_table', ref.relname, 'reference_column', ref_col.attname,
    'fk_def', pg_get_constraintdef(con.oid)
  ) ORDER BY src.relname, con.conname, key.ordinality), '[]'::jsonb) AS value
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = src.relnamespace
  JOIN pg_class ref ON ref.oid = con.confrelid
  JOIN pg_namespace nr ON nr.oid = ref.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS key(src_num, ref_num, ordinality)
  JOIN pg_attribute src_col ON src_col.attrelid = src.oid AND src_col.attnum = key.src_num
  JOIN pg_attribute ref_col ON ref_col.attrelid = ref.oid AND ref_col.attnum = key.ref_num
  WHERE ns.nspname = ${target} AND con.contype = 'f'
), indexes_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', tbl.relname, 'name', idx.relname,
    'column', att.attname, 'index_type', am.amname, 'unique', ix.indisunique,
    'column_position', key.ordinality
  ) ORDER BY tbl.relname, idx.relname, key.ordinality), '[]'::jsonb) AS value
  FROM pg_index ix
  JOIN pg_class tbl ON tbl.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = tbl.relnamespace
  JOIN pg_class idx ON idx.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = idx.relam
  CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS key(attnum, ordinality)
  JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = key.attnum
  WHERE n.nspname = ${target} AND key.attnum > 0
), views_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('schema', schemaname, 'view_name', viewname) ORDER BY viewname), '[]'::jsonb) AS value
  FROM pg_views WHERE schemaname = ${target}
), checks_meta AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname, 'constraint_name', con.conname,
    'check_clause', pg_get_constraintdef(con.oid)
  ) ORDER BY c.relname, con.conname), '[]'::jsonb) AS value
  FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ${target} AND con.contype = 'c'
)
SELECT jsonb_build_object(
  'tables', tables_meta.value, 'views', views_meta.value,
  'columns', columns_meta.value, 'pk_info', pk_meta.value,
  'fk_info', fk_meta.value, 'indexes', indexes_meta.value,
  'check_constraints', checks_meta.value, 'custom_types', '[]'::jsonb,
  'database_name', current_database(), 'version', version()
) AS metadata_json_to_import
FROM tables_meta, views_meta, columns_meta, pk_meta, fk_meta, indexes_meta, checks_meta;`;
}

function mysqlMetadataQuery(schema: string) {
  const target = sqlLiteral(schema);
  return `/* OxideStudio / ChartDB-compatible metadata capture: MySQL 8+ */
SELECT JSON_OBJECT(
  'tables', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', t.TABLE_SCHEMA, 'table', t.TABLE_NAME, 'type', t.TABLE_TYPE,
    'rows', t.TABLE_ROWS, 'engine', t.ENGINE, 'collation', t.TABLE_COLLATION
  )) FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA = ${target}), JSON_ARRAY()),
  'views', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', v.TABLE_SCHEMA, 'view_name', v.TABLE_NAME
  )) FROM information_schema.VIEWS v WHERE v.TABLE_SCHEMA = ${target}), JSON_ARRAY()),
  'columns', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', c.TABLE_SCHEMA, 'table', c.TABLE_NAME, 'name', c.COLUMN_NAME,
    'type', c.DATA_TYPE, 'ordinal_position', c.ORDINAL_POSITION,
    'nullable', c.IS_NULLABLE = 'YES', 'default', c.COLUMN_DEFAULT,
    'character_maximum_length', c.CHARACTER_MAXIMUM_LENGTH,
    'precision', IF(c.NUMERIC_PRECISION IS NULL, NULL, JSON_OBJECT('precision', c.NUMERIC_PRECISION, 'scale', c.NUMERIC_SCALE)),
    'is_identity', LOWER(c.EXTRA) LIKE '%auto_increment%', 'comment', c.COLUMN_COMMENT
  )) FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA = ${target}), JSON_ARRAY()),
  'pk_info', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', k.TABLE_SCHEMA, 'table', k.TABLE_NAME, 'column', k.COLUMN_NAME,
    'pk_def', CONCAT('PRIMARY KEY (', k.COLUMN_NAME, ')')
  )) FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
    AND k.TABLE_NAME = tc.TABLE_NAME AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = ${target}), JSON_ARRAY()),
  'fk_info', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', k.TABLE_SCHEMA, 'table', k.TABLE_NAME, 'column', k.COLUMN_NAME,
    'foreign_key_name', k.CONSTRAINT_NAME, 'reference_schema', k.REFERENCED_TABLE_SCHEMA,
    'reference_table', k.REFERENCED_TABLE_NAME, 'reference_column', k.REFERENCED_COLUMN_NAME,
    'fk_def', CONCAT('FOREIGN KEY (', k.COLUMN_NAME, ') REFERENCES ', k.REFERENCED_TABLE_NAME, '(', k.REFERENCED_COLUMN_NAME, ')')
  )) FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.TABLE_SCHEMA = ${target} AND k.REFERENCED_TABLE_NAME IS NOT NULL), JSON_ARRAY()),
  'indexes', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', s.TABLE_SCHEMA, 'table', s.TABLE_NAME, 'name', s.INDEX_NAME,
    'column', s.COLUMN_NAME, 'index_type', s.INDEX_TYPE,
    'unique', s.NON_UNIQUE = 0, 'column_position', s.SEQ_IN_INDEX
  )) FROM information_schema.STATISTICS s WHERE s.TABLE_SCHEMA = ${target}), JSON_ARRAY()),
  'check_constraints', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema', tc.TABLE_SCHEMA, 'table', tc.TABLE_NAME,
    'constraint_name', tc.CONSTRAINT_NAME, 'check_clause', cc.CHECK_CLAUSE
  )) FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.TABLE_SCHEMA = ${target} AND tc.CONSTRAINT_TYPE = 'CHECK'), JSON_ARRAY()),
  'custom_types', JSON_ARRAY(), 'database_name', DATABASE(), 'version', VERSION()
) AS metadata_json_to_import;`;
}

function sqliteMetadataQuery() {
  return `/* OxideStudio / ChartDB-compatible metadata capture: SQLite JSON1 */
WITH tables_meta AS (
  SELECT COALESCE(json_group_array(json_object(
    'schema', '', 'table', name,
    'type', CASE type WHEN 'view' THEN 'VIEW' ELSE 'BASE TABLE' END
  )), json('[]')) AS value FROM sqlite_schema
  WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
), views_meta AS (
  SELECT COALESCE(json_group_array(json_object('schema', '', 'view_name', name)), json('[]')) AS value
  FROM sqlite_schema WHERE type = 'view'
), columns_meta AS (
  SELECT COALESCE(json_group_array(json_object(
    'schema', '', 'table', m.name, 'name', p.name, 'type', lower(p.type),
    'ordinal_position', p.cid + 1, 'nullable', p."notnull" = 0,
    'default', p.dflt_value, 'is_identity', 0
  )), json('[]')) AS value
  FROM sqlite_schema m JOIN pragma_table_info(m.name) p
  WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%'
), pk_meta AS (
  SELECT COALESCE(json_group_array(json_object(
    'schema', '', 'table', m.name, 'column', p.name,
    'pk_def', 'PRIMARY KEY (' || p.name || ')'
  )), json('[]')) AS value
  FROM sqlite_schema m JOIN pragma_table_info(m.name) p
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND p.pk > 0
), fk_meta AS (
  SELECT COALESCE(json_group_array(json_object(
    'schema', '', 'table', m.name, 'column', fk."from",
    'foreign_key_name', 'fk_' || m.name || '_' || fk.id,
    'reference_schema', '', 'reference_table', fk."table", 'reference_column', fk."to",
    'fk_def', 'FOREIGN KEY (' || fk."from" || ') REFERENCES ' || fk."table" || '(' || fk."to" || ')'
  )), json('[]')) AS value
  FROM sqlite_schema m JOIN pragma_foreign_key_list(m.name) fk
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
), indexes_meta AS (
  SELECT COALESCE(json_group_array(json_object(
    'schema', '', 'table', m.name, 'name', idx.name, 'column', col.name,
    'index_type', 'B-TREE', 'unique', idx."unique" = 1,
    'column_position', col.seqno + 1
  )), json('[]')) AS value
  FROM sqlite_schema m JOIN pragma_index_list(m.name) idx JOIN pragma_index_info(idx.name) col
  WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
)
SELECT json_object(
  'tables', json(tables_meta.value), 'views', json(views_meta.value),
  'columns', json(columns_meta.value), 'pk_info', json(pk_meta.value),
  'fk_info', json(fk_meta.value), 'indexes', json(indexes_meta.value),
  'check_constraints', json('[]'), 'custom_types', json('[]'),
  'database_name', 'sqlite', 'version', sqlite_version()
) AS metadata_json_to_import
FROM tables_meta, views_meta, columns_meta, pk_meta, fk_meta, indexes_meta;`;
}

function sqlServerMetadataQuery(schema: string) {
  const target = sqlLiteral(schema);
  return `/* OxideStudio / ChartDB-compatible metadata capture: SQL Server 2017+ */
SELECT (
  SELECT
    JSON_QUERY((SELECT s.name AS [schema], t.name AS [table], 'BASE TABLE' AS [type]
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = ${target} FOR JSON PATH)) AS tables,
    JSON_QUERY((SELECT s.name AS [schema], v.name AS view_name
      FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id
      WHERE s.name = ${target} FOR JSON PATH)) AS views,
    JSON_QUERY((SELECT s.name AS [schema], o.name AS [table], c.name,
      ty.name AS [type], c.column_id AS ordinal_position, CONVERT(bit, c.is_nullable) AS nullable,
      dc.definition AS [default], c.max_length AS character_maximum_length,
      CONVERT(bit, c.is_identity) AS is_identity
      FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id
      JOIN sys.schemas s ON s.schema_id = o.schema_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      WHERE s.name = ${target} AND o.type IN ('U', 'V') FOR JSON PATH)) AS columns,
    JSON_QUERY((SELECT s.name AS [schema], t.name AS [table], c.name AS [column],
      'PRIMARY KEY (' + c.name + ')' AS pk_def
      FROM sys.key_constraints kc JOIN sys.tables t ON t.object_id = kc.parent_object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
      JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
      WHERE s.name = ${target} AND kc.type = 'PK' FOR JSON PATH)) AS pk_info,
    JSON_QUERY((SELECT ps.name AS [schema], pt.name AS [table], pc.name AS [column],
      fk.name AS foreign_key_name, rs.name AS reference_schema, rt.name AS reference_table,
      rc.name AS reference_column, 'FOREIGN KEY (' + pc.name + ') REFERENCES ' + rt.name + '(' + rc.name + ')' AS fk_def
      FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
      JOIN sys.columns pc ON pc.object_id = pt.object_id AND pc.column_id = fkc.parent_column_id
      JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
      JOIN sys.columns rc ON rc.object_id = rt.object_id AND rc.column_id = fkc.referenced_column_id
      WHERE ps.name = ${target} FOR JSON PATH)) AS fk_info,
    JSON_QUERY((SELECT s.name AS [schema], t.name AS [table], i.name, c.name AS [column],
      i.type_desc AS index_type, CONVERT(bit, i.is_unique) AS [unique], ic.key_ordinal AS column_position
      FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
      WHERE s.name = ${target} AND i.name IS NOT NULL AND ic.is_included_column = 0 FOR JSON PATH)) AS indexes,
    JSON_QUERY((SELECT s.name AS [schema], t.name AS [table], cc.name AS constraint_name, cc.definition AS check_clause
      FROM sys.check_constraints cc JOIN sys.tables t ON t.object_id = cc.parent_object_id
      JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = ${target} FOR JSON PATH)) AS check_constraints,
    JSON_QUERY('[]') AS custom_types, DB_NAME() AS database_name,
    CONVERT(varchar(128), SERVERPROPERTY('ProductVersion')) AS version
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS metadata_json_to_import;`;
}

function clickHouseMetadataQuery(database: string) {
  const target = sqlLiteral(database);
  return `/* OxideStudio / ChartDB-compatible metadata capture: ClickHouse */
SELECT concat(
  '{"tables":', (SELECT toJSONString(groupArray(map('schema', database, 'table', name, 'type', 'BASE TABLE'))) FROM system.tables WHERE database = ${target}),
  ',"views":[]',
  ',"columns":', (SELECT toJSONString(groupArray(map(
    'schema', database, 'table', table, 'name', name, 'type', type,
    'ordinal_position', toString(position), 'nullable', toString(startsWith(type, 'Nullable(')),
    'default', default_expression
  ))) FROM system.columns WHERE database = ${target}),
  ',"pk_info":[],"fk_info":[],"indexes":[],"check_constraints":[],"custom_types":[]',
  ',"database_name":', toJSONString(${target}), ',"version":', toJSONString(version()), '}'
) AS metadata_json_to_import;`;
}

function oracleMetadataQuery(schema: string) {
  const target = sqlLiteral(schema.toUpperCase());
  return `/* OxideStudio / ChartDB-compatible metadata capture: Oracle 19c+ */
SELECT JSON_OBJECT(
  'tables' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE owner, 'table' VALUE table_name, 'type' VALUE 'BASE TABLE'
  ) RETURNING CLOB) FROM all_tables WHERE owner = ${target}), JSON_ARRAY() RETURNING CLOB),
  'views' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE owner, 'view_name' VALUE view_name
  ) RETURNING CLOB) FROM all_views WHERE owner = ${target}), JSON_ARRAY() RETURNING CLOB),
  'columns' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE owner, 'table' VALUE table_name, 'name' VALUE column_name,
    'type' VALUE data_type, 'ordinal_position' VALUE column_id,
    'nullable' VALUE CASE nullable WHEN 'Y' THEN 'true' ELSE 'false' END FORMAT JSON,
    'default' VALUE data_default, 'character_maximum_length' VALUE char_length,
    'precision' VALUE CASE WHEN data_precision IS NULL THEN NULL ELSE JSON_OBJECT('precision' VALUE data_precision, 'scale' VALUE data_scale) END
  ) RETURNING CLOB) FROM all_tab_columns WHERE owner = ${target}), JSON_ARRAY() RETURNING CLOB),
  'pk_info' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE c.owner, 'table' VALUE c.table_name, 'column' VALUE col.column_name,
    'pk_def' VALUE 'PRIMARY KEY (' || col.column_name || ')'
  ) RETURNING CLOB) FROM all_constraints c JOIN all_cons_columns col
    ON col.owner = c.owner AND col.constraint_name = c.constraint_name
    WHERE c.owner = ${target} AND c.constraint_type = 'P'), JSON_ARRAY() RETURNING CLOB),
  'fk_info' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE c.owner, 'table' VALUE c.table_name, 'column' VALUE src.column_name,
    'foreign_key_name' VALUE c.constraint_name, 'reference_schema' VALUE r.owner,
    'reference_table' VALUE r.table_name, 'reference_column' VALUE dst.column_name
  ) RETURNING CLOB) FROM all_constraints c
    JOIN all_cons_columns src ON src.owner = c.owner AND src.constraint_name = c.constraint_name
    JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
    JOIN all_cons_columns dst ON dst.owner = r.owner AND dst.constraint_name = r.constraint_name AND dst.position = src.position
    WHERE c.owner = ${target} AND c.constraint_type = 'R'), JSON_ARRAY() RETURNING CLOB),
  'indexes' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE i.owner, 'table' VALUE i.table_name, 'name' VALUE i.index_name,
    'column' VALUE c.column_name, 'index_type' VALUE i.index_type,
    'unique' VALUE CASE i.uniqueness WHEN 'UNIQUE' THEN 'true' ELSE 'false' END FORMAT JSON,
    'column_position' VALUE c.column_position
  ) RETURNING CLOB) FROM all_indexes i JOIN all_ind_columns c
    ON c.index_owner = i.owner AND c.index_name = i.index_name
    WHERE i.owner = ${target}), JSON_ARRAY() RETURNING CLOB),
  'check_constraints' VALUE COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
    'schema' VALUE owner, 'table' VALUE table_name, 'constraint_name' VALUE constraint_name,
    'check_clause' VALUE search_condition_vc
  ) RETURNING CLOB) FROM all_constraints WHERE owner = ${target} AND constraint_type = 'C'), JSON_ARRAY() RETURNING CLOB),
  'custom_types' VALUE JSON_ARRAY(), 'database_name' VALUE SYS_CONTEXT('USERENV', 'DB_NAME'),
  'version' VALUE (SELECT version FROM product_component_version WHERE product LIKE 'Oracle Database%' FETCH FIRST 1 ROW ONLY)
  RETURNING CLOB
) AS metadata_json_to_import FROM dual;`;
}

function sqlLiteral(value: string) {
  return `'${value.replace(/'/gu, "''")}'`;
}
