import fs from 'node:fs';
const cases = [];
const add = (id, profile, marked, field, type, category = 'semantic', extra = {}) => cases.push({ id, profile, marked, expected: { field, ...(type ? { type } : {}), ...extra }, category });
for (const p of ['postgres', 'mysql', 'sqlserver', 'sqlite', 'hive', 'clickhouse'])
    add('plain-member-' + p, p, 'SELECT u.na<cursor>me FROM users u', 'name', 'text', 'control');
for (const p of ['postgres', 'mysql', 'sqlserver', 'sqlite', 'hive'])
    add('cte-projection-' + p, p, 'WITH q AS(SELECT total AS amount FROM orders) SELECT q.am<cursor>ount FROM q', 'amount', 'decimal');
add('pg-fulltext-result', 'postgres', "WITH q AS(SELECT to_tsvector('simple',u.name) @@ plainto_tsquery('simple','rust') AS matched FROM users u) SELECT q.ma<cursor>tched FROM q", 'matched', 'boolean', 'search');
add('mysql-fulltext-score', 'mysql', "WITH q AS(SELECT MATCH(u.name) AGAINST('rust' IN BOOLEAN MODE) AS score FROM users u) SELECT q.sc<cursor>ore FROM q", 'score', 'double', 'search');
add('pg-json-result', 'postgres', "WITH q AS(SELECT u.payload->>'name' AS display_name FROM users u) SELECT q.dis<cursor>play_name FROM q", 'display_name', 'text', 'search');
add('mysql-json-table', 'mysql', "SELECT j.ci<cursor>ty FROM users u JOIN JSON_TABLE(u.payload,'$' COLUMNS(city varchar(40) PATH '$.city')) j ON true", 'city', 'varchar(40)', 'table-function');
add('tsql-openjson', 'sqlserver', "SELECT j.ci<cursor>ty FROM users u CROSS APPLY OPENJSON(u.payload) WITH(city nvarchar(100) '$.city') j", 'city', 'nvarchar(100)', 'table-function');
add('tsql-variable', 'sqlserver', 'DECLARE @value int=COALESCE(1,2); SELECT @va<cursor>lue', '@value', 'int', 'variable', { kind: 'variable' });
for (const p of ['postgres', 'mysql', 'sqlserver'])
    add('recursive-anchor-' + p, p, `WITH ${p === 'sqlserver' ? '' : 'RECURSIVE '}q(id) AS(SELECT id FROM users UNION ALL SELECT id FROM q WHERE id<10) SELECT q.i<cursor>d FROM q`, 'id', 'bigint');
add('window-output', 'postgres', 'WITH q AS(SELECT row_number() OVER(ORDER BY total) AS rn FROM orders) SELECT q.r<cursor>n FROM q', 'rn', 'bigint');
add('case-output', 'postgres', "WITH q AS(SELECT CASE WHEN total>0 THEN name ELSE 'none' END AS caption FROM users JOIN orders USING(id)) SELECT q.cap<cursor>tion FROM q", 'caption', 'text');
add('scalar-output', 'postgres', 'WITH q AS(SELECT (SELECT o.total) AS amount FROM orders o) SELECT q.am<cursor>ount FROM q', 'amount', 'decimal');
add('group-alias', 'postgres', 'SELECT g.to<cursor>tal FROM (users u JOIN orders o USING(id)) g', 'total', 'decimal');
add('grouped-lateral', 'postgres', 'SELECT * FROM (users u JOIN orders o USING(id)) g CROSS JOIN LATERAL(SELECT g.to<cursor>tal) d', 'total', 'decimal');
add('grouped-lateral-cte', 'postgres', 'WITH q AS(SELECT d.* FROM (users u JOIN orders o USING(id)) g CROSS JOIN LATERAL(SELECT g.total AS amount) d) SELECT q.am<cursor>ount FROM q', 'amount', 'decimal');
add('grouped-apply', 'sqlserver', 'SELECT * FROM (users u JOIN orders o ON u.id=o.id) OUTER APPLY(SELECT o.to<cursor>tal) d', 'total', 'decimal');
add('using-key', 'postgres', 'SELECT i<cursor>d FROM users u JOIN orders o USING(id)', 'id', 'bigint', 'join', { single: true });
add('natural-key', 'postgres', 'SELECT i<cursor>d FROM users u NATURAL LEFT JOIN orders o', 'id', 'bigint', 'join', { single: true });
add('grouped-outer-key', 'postgres', 'SELECT * FROM (users u JOIN orders o USING(id)) CROSS JOIN LATERAL(SELECT i<cursor>d) d', 'id', 'bigint', 'join', { single: true });
add('future-on-leak', 'postgres', "SELECT u.id FROM users u JOIN orders o ON audit_<cursor>secret='x' JOIN audit_events a ON true", null, null, 'isolation', { forbidden: ['audit_secret'] });
add('comma-on-leak', 'postgres', "SELECT u.id FROM audit_events a,users u JOIN orders o ON audit_<cursor>secret='x'", null, null, 'isolation', { forbidden: ['audit_secret'] });
add('sqlite-future-on', 'sqlite', "SELECT u.id FROM users u JOIN orders o ON audit_<cursor>secret='x' JOIN audit_events a ON true", 'audit_secret', 'text', 'join');
add('group-hidden-alias', 'postgres', 'SELECT o.to<cursor>tal FROM (users u JOIN orders o USING(id)) g', null, null, 'isolation', { forbidden: ['total'] });
add('derived-isolation', 'postgres', 'SELECT * FROM orders o CROSS JOIN(SELECT o.to<cursor>tal) d', null, null, 'isolation', { forbidden: ['total'] });
add('lateral-future-isolation', 'postgres', 'SELECT * FROM users u CROSS JOIN LATERAL(SELECT o.to<cursor>tal) d CROSS JOIN orders o', null, null, 'isolation', { forbidden: ['total'] });
add('pg-correlation', 'postgres', 'SELECT * FROM orders o WHERE EXISTS(SELECT o.to<cursor>tal FROM users u)', 'total', 'decimal');
add('pg-quoted-unicode', 'postgres', '/*😀*/\r\nSELECT "用户😀".na<cursor>me FROM users "用户😀"', 'name', 'text', 'unicode');
add('mysql-quoted-field', 'mysql', 'SELECT `用户`.`na<cursor>me` FROM users `用户`', 'name', 'text', 'unicode');
add('sqlserver-quoted-field', 'sqlserver', 'SELECT [用户].[na<cursor>me] FROM users [用户]', 'name', 'text', 'unicode');
add('unfinished-group-member', 'postgres', 'SELECT g.<cursor> FROM (users u JOIN orders o USING(id)) g', 'total', 'decimal', 'unfinished');
add('union-second-branch', 'postgres', 'SELECT g.id FROM (users u JOIN orders o USING(id)) g UNION ALL SELECT q.to<cursor>tal FROM (users u JOIN orders o USING(id)) q', 'total', 'decimal');
add('sqlserver-outer-literal', 'sqlserver', 'SELECT d.va<cursor>lue FROM (orders o OUTER APPLY(SELECT 1 AS value) d)', 'value', 'int');
add('qualified-star-cte', 'postgres', 'WITH q AS(SELECT o.* FROM orders o) SELECT q.to<cursor>tal FROM q', 'total', 'decimal');
add('large-comment-unicode', 'postgres', `/*${'😀'.repeat(64)}*/\r\nWITH q AS(SELECT total AS amount FROM orders) SELECT q.am<cursor>ount FROM q`, 'amount', 'decimal', 'unicode');
add('literal-suppression', 'postgres', "SELECT 'u.na<cursor>me' FROM users u", null, null, 'suppression', { noFields: true });
add('comment-suppression', 'postgres', 'SELECT 1 /* u.na<cursor>me */ FROM users u', null, null, 'suppression', { noFields: true });
add('metadata-pinyin', 'mysql', 'SELECT zj<cursor> FROM ledger', '租金总额', 'decimal', 'identifier-search');
add('metadata-comment', 'mysql', 'SELECT rev<cursor> FROM ledger', 'amount', 'decimal', 'identifier-search');
add('clickhouse-qualify', 'clickhouse', 'SELECT row_number() OVER(ORDER BY total) AS rn FROM orders QUALIFY r<cursor>n=1', 'rn', null, 'dialect');
add('manticore-search', 'manticoresearch', "SELECT u.i<cursor>d FROM users u WHERE MATCH('@name rust')", 'id', 'bigint', 'search');
add('hive-lateral-view', 'hive', "SELECT e.it<cursor>em FROM orders o LATERAL VIEW explode(o.tags) e AS item", 'item', null, 'dialect');
add('pg-comma-lateral', 'postgres', 'SELECT * FROM orders o,LATERAL(SELECT o.to<cursor>tal) d', 'total', 'decimal', 'dialect');
const tables = [
    { name: 'users', columns: [['id', 'bigint'], ['name', 'text'], ['email', 'text'], ['payload', 'jsonb']].map(([name, data_type]) => ({ name, data_type, nullable: false })) },
    { name: 'orders', columns: [['id', 'bigint'], ['customer_id', 'bigint'], ['total', 'decimal'], ['status', 'text'], ['created_at', 'timestamp'], ['tags', 'text[]']].map(([name, data_type]) => ({ name, data_type, nullable: false })) },
    { name: 'audit_events', columns: [{ name: 'audit_secret', data_type: 'text', nullable: false }] },
    { name: 'ledger', columns: [{ name: '租金总额', data_type: 'decimal', nullable: false }, { name: 'amount', data_type: 'decimal', nullable: false, comment: '营业收入 Revenue amount' }] },
];
fs.writeFileSync('.impeccable/review/dbx-runtime-comparison/fixtures.json', JSON.stringify({ version: 1, scope: 'synthetic metadata; completion algorithms and CodeMirror EditorState, not database execution or visible UI', tables, cases }, null, 2) + '\n');
console.log(JSON.stringify({ cases: cases.length, tables: tables.length }));
