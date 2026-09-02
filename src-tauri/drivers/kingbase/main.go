// Standalone KingbaseES sidecar for the signed Oxide driver protocol.
//
// It intentionally has no dependency on the desktop process. The package is
// launched with one connection secret over private stdio, owns the Kingbase
// client lifecycle, and returns only bounded JSON protocol messages.
package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	_ "gitea.com/kingbase/gokb"
)

const (
	packageID      = "oxide.kingbase"
	packageVersion = "0.1.0"
	driverID       = "kingbase"
	maxRows        = 10000
)

type envelope struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}
type response struct {
	ID     uint64 `json:"id"`
	Status string `json:"status"`
	Result any    `json:"result,omitempty"`
}
type protocolError struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	Retryable bool              `json:"retryable"`
	Details   map[string]string `json:"details"`
}
type secretConfig struct {
	URL     string            `json:"url"`
	Options map[string]string `json:"options"`
}
type queryContext struct {
	Database *string `json:"database"`
	Schema   *string `json:"schema"`
	ReadOnly bool    `json:"readOnly"`
}
type queryParam struct {
	Value    any     `json:"value"`
	DataType *string `json:"dataType"`
}
type column struct {
	Name     string `json:"name"`
	DataType string `json:"dataType"`
}
type queryResult struct {
	Columns       []column `json:"columns"`
	Rows          [][]any  `json:"rows"`
	Truncated     bool     `json:"truncated"`
	RowLimit      *uint64  `json:"rowLimit"`
	RowsAffected  *uint64  `json:"rowsAffected"`
	StatementType string   `json:"statementType"`
}

type agent struct {
	mu          sync.Mutex
	connections map[string]*sql.DB
	active      map[string]context.CancelFunc
}

func main() {
	a := &agent{connections: map[string]*sql.DB{}, active: map[string]context.CancelFunc{}}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	var encoderMu sync.Mutex
	var requests sync.WaitGroup
	for scanner.Scan() {
		var request envelope
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			encoderMu.Lock()
			_ = encoder.Encode(response{Status: "error", Result: fail("INVALID_REQUEST", err.Error())})
			encoderMu.Unlock()
			continue
		}
		if request.Method == "shutdown" {
			requests.Wait()
			result, err := a.dispatch(request)
			encoderMu.Lock()
			if err != nil {
				_ = encoder.Encode(response{ID: request.ID, Status: "error", Result: err})
			} else {
				_ = encoder.Encode(response{ID: request.ID, Status: "ok", Result: result})
			}
			encoderMu.Unlock()
			return
		}
		requests.Add(1)
		go func(request envelope) {
			defer requests.Done()
			result, err := a.dispatch(request)
			encoderMu.Lock()
			defer encoderMu.Unlock()
			if err != nil {
				_ = encoder.Encode(response{ID: request.ID, Status: "error", Result: err})
				return
			}
			_ = encoder.Encode(response{ID: request.ID, Status: "ok", Result: result})
		}(request)
	}
	requests.Wait()
	a.closeAll()
}

func (a *agent) dispatch(request envelope) (any, *protocolError) {
	switch request.Method {
	case "handshake":
		return map[string]any{"kind": "handshake", "value": map[string]any{"protocolVersion": "1.0", "packageId": packageID, "packageVersion": packageVersion, "driverId": driverID, "capabilities": map[string]any{"metadata": true, "query": true, "cancellation": true, "transactions": false, "databaseScopedQueries": false, "databaseCreation": false, "referencingForeignKeys": true, "schemaObjects": true, "schemaObjectMembers": false, "readOnlyEnforcement": true, "semanticSchemaMigration": false}}}, nil
	case "connect":
		var p struct {
			ConnectionID string       `json:"connection_id"`
			Config       secretConfig `json:"config"`
		}
		if err := json.Unmarshal(request.Params, &p); err != nil {
			return nil, fail("INVALID_REQUEST", err.Error())
		}
		return map[string]any{"kind": "empty"}, a.connect(p.ConnectionID, p.Config)
	case "disconnect":
		var p struct {
			ConnectionID string `json:"connection_id"`
		}
		if err := json.Unmarshal(request.Params, &p); err != nil {
			return nil, fail("INVALID_REQUEST", err.Error())
		}
		a.disconnect(p.ConnectionID)
		return map[string]any{"kind": "empty"}, nil
	case "ping":
		return map[string]any{"kind": "boolean", "value": true}, a.ping(request.Params)
	case "serverVersion":
		return a.version(request.Params)
	case "query":
		return a.query(request.Params)
	case "metadata":
		return a.metadata(request.Params)
	case "cancel":
		return a.cancel(request.Params)
	case "shutdown":
		a.closeAll()
		return map[string]any{"kind": "empty"}, nil
	default:
		return nil, fail("UNSUPPORTED", "Kingbase package does not support "+request.Method)
	}
}

func (a *agent) connect(id string, config secretConfig) *protocolError {
	if strings.TrimSpace(id) == "" {
		return fail("INVALID_CONNECTION", "Connection id is required")
	}
	dsn := strings.TrimSpace(config.URL)
	if dsn == "" {
		return fail("INVALID_URL", "Kingbase connection URL is required")
	}
	if strings.HasPrefix(strings.ToLower(dsn), "jdbc:kingbase8:") {
		dsn = dsn[len("jdbc:"):]
	}
	db, err := sql.Open("kingbase", dsn)
	if err != nil {
		return fail("CONNECT_FAILED", err.Error())
	}
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return fail("CONNECT_FAILED", err.Error())
	}
	a.mu.Lock()
	previous := a.connections[id]
	a.connections[id] = db
	a.mu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	return nil
}
func (a *agent) db(id string) (*sql.DB, *protocolError) {
	a.mu.Lock()
	defer a.mu.Unlock()
	db := a.connections[id]
	if db == nil {
		return nil, fail("CONNECTION_NOT_FOUND", "Connection is not open")
	}
	return db, nil
}
func (a *agent) disconnect(id string) {
	a.mu.Lock()
	db := a.connections[id]
	delete(a.connections, id)
	for key, cancel := range a.active {
		if strings.HasPrefix(key, id+"\x00") {
			cancel()
			delete(a.active, key)
		}
	}
	a.mu.Unlock()
	if db != nil {
		_ = db.Close()
	}
}
func (a *agent) closeAll() {
	a.mu.Lock()
	all := a.connections
	a.connections = map[string]*sql.DB{}
	for _, cancel := range a.active {
		cancel()
	}
	a.active = map[string]context.CancelFunc{}
	a.mu.Unlock()
	for _, db := range all {
		_ = db.Close()
	}
}

func (a *agent) ping(raw json.RawMessage) *protocolError {
	var p struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return fail("INVALID_REQUEST", err.Error())
	}
	db, e := a.db(p.ConnectionID)
	if e != nil {
		return e
	}
	if err := db.Ping(); err != nil {
		return fail("PING_FAILED", err.Error())
	}
	return nil
}
func (a *agent) version(raw json.RawMessage) (any, *protocolError) {
	var p struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fail("INVALID_REQUEST", err.Error())
	}
	db, e := a.db(p.ConnectionID)
	if e != nil {
		return nil, e
	}
	var version string
	if err := db.QueryRow("SELECT version()").Scan(&version); err != nil {
		return nil, fail("VERSION_FAILED", err.Error())
	}
	return map[string]any{"kind": "serverVersion", "value": version}, nil
}

func (a *agent) query(raw json.RawMessage) (any, *protocolError) {
	var p struct {
		ConnectionID string       `json:"connection_id"`
		Statement    string       `json:"statement"`
		Parameters   []queryParam `json:"parameters"`
		Context      queryContext `json:"context"`
		QueryID      string       `json:"query_id"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fail("INVALID_REQUEST", err.Error())
	}
	db, e := a.db(p.ConnectionID)
	if e != nil {
		return nil, e
	}
	if strings.TrimSpace(p.Statement) == "" {
		return nil, fail("QUERY_EMPTY", "SQL statement is required")
	}
	if p.Context.ReadOnly && !readOnly(p.Statement) {
		return nil, fail("READ_ONLY_REJECTED", "Read-only query required")
	}
	args := make([]any, len(p.Parameters))
	for i, v := range p.Parameters {
		args[i] = v.Value
	}
	queryID := p.QueryID
	if queryID == "" {
		queryID = "__default__"
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.setActive(p.ConnectionID, queryID, cancel)
	defer a.clearActive(p.ConnectionID, queryID, cancel)
	typ := statementType(p.Statement)
	if !rowReturning(typ) {
		n, err := db.ExecContext(ctx, p.Statement, args...)
		if ctx.Err() != nil {
			return nil, fail("QUERY_CANCELED", "Kingbase query was canceled")
		}
		if err != nil {
			return nil, fail("QUERY_FAILED", err.Error())
		}
		affected, _ := n.RowsAffected()
		u := uint64(affected)
		return map[string]any{"kind": "query", "value": []queryResult{{Rows: [][]any{}, Columns: []column{}, RowsAffected: &u, StatementType: typ}}}, nil
	}
	rows, err := db.QueryContext(ctx, p.Statement, args...)
	if ctx.Err() != nil {
		return nil, fail("QUERY_CANCELED", "Kingbase query was canceled")
	}
	if err != nil {
		return nil, fail("QUERY_FAILED", err.Error())
	}
	defer rows.Close()
	names, _ := rows.Columns()
	types, _ := rows.ColumnTypes()
	columns := make([]column, len(names))
	for i, name := range names {
		kind := "UNKNOWN"
		if i < len(types) {
			kind = types[i].DatabaseTypeName()
		}
		columns[i] = column{Name: name, DataType: kind}
	}
	values := make([][]any, 0)
	truncated := false
	for rows.Next() {
		if ctx.Err() != nil {
			return nil, fail("QUERY_CANCELED", "Kingbase query was canceled")
		}
		if len(values) >= maxRows {
			truncated = true
			break
		}
		rawValues := make([]any, len(columns))
		scan := make([]any, len(columns))
		for i := range rawValues {
			scan[i] = &rawValues[i]
		}
		if err := rows.Scan(scan...); err != nil {
			return nil, fail("QUERY_DECODE_FAILED", err.Error())
		}
		item := make([]any, len(columns))
		for i, value := range rawValues {
			item[i] = jsonValue(value)
		}
		values = append(values, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fail("QUERY_FAILED", err.Error())
	}
	limit := uint64(maxRows)
	return map[string]any{"kind": "query", "value": []queryResult{{Columns: columns, Rows: values, Truncated: truncated, RowLimit: &limit, StatementType: typ}}}, nil
}

func (a *agent) cancel(raw json.RawMessage) (any, *protocolError) {
	var p struct {
		ConnectionID string `json:"connection_id"`
		QueryID      string `json:"query_id"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fail("INVALID_REQUEST", err.Error())
	}
	if p.QueryID == "" {
		p.QueryID = "__default__"
	}
	return map[string]any{"kind": "boolean", "value": a.cancelActive(p.ConnectionID, p.QueryID)}, nil
}

func activeQueryKey(connectionID, queryID string) string { return connectionID + "\x00" + queryID }

func (a *agent) setActive(connectionID, queryID string, cancel context.CancelFunc) {
	a.mu.Lock()
	a.active[activeQueryKey(connectionID, queryID)] = cancel
	a.mu.Unlock()
}

func (a *agent) clearActive(connectionID, queryID string, cancel context.CancelFunc) {
	a.mu.Lock()
	delete(a.active, activeQueryKey(connectionID, queryID))
	a.mu.Unlock()
	cancel()
}

func (a *agent) cancelActive(connectionID, queryID string) bool {
	a.mu.Lock()
	cancel := a.active[activeQueryKey(connectionID, queryID)]
	a.mu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
}

func (a *agent) metadata(raw json.RawMessage) (any, *protocolError) {
	var p struct {
		ConnectionID string `json:"connection_id"`
		Request      struct {
			Kind       string  `json:"kind"`
			Database   *string `json:"database"`
			Namespace  string  `json:"namespace"`
			Relation   string  `json:"relation"`
			ObjectName string  `json:"object_name"`
			ObjectType string  `json:"object_type"`
		} `json:"request"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fail("INVALID_REQUEST", err.Error())
	}
	db, e := a.db(p.ConnectionID)
	if e != nil {
		return nil, e
	}
	if p.Request.Kind == "indexes" {
		out, err := listKingbaseIndexes(db, p.Request.Namespace, p.Request.Relation)
		if err != nil {
			return nil, fail("METADATA_FAILED", err.Error())
		}
		return map[string]any{"kind": "metadata", "value": out}, nil
	}
	if p.Request.Kind == "constraints" {
		out, err := listKingbaseConstraints(db, p.Request.Namespace, p.Request.Relation)
		if err != nil {
			return nil, fail("METADATA_FAILED", err.Error())
		}
		return map[string]any{"kind": "metadata", "value": out}, nil
	}
	if p.Request.Kind == "routines" {
		out, err := listKingbaseRoutines(db, p.Request.Namespace)
		if err != nil {
			return nil, fail("METADATA_FAILED", err.Error())
		}
		return map[string]any{"kind": "metadata", "value": out}, nil
	}
	if p.Request.Kind == "referencingForeignKeys" {
		out, err := listKingbaseReferencingForeignKeys(db, p.Request.Namespace, p.Request.Relation)
		if err != nil {
			return nil, fail("METADATA_FAILED", err.Error())
		}
		return map[string]any{"kind": "metadata", "value": out}, nil
	}
	if p.Request.Kind == "schemaObjects" {
		out, err := listKingbaseSchemaObjects(db, p.Request.Namespace)
		if err != nil {
			return nil, fail("METADATA_FAILED", err.Error())
		}
		return map[string]any{"kind": "metadata", "value": out}, nil
	}
	var sqlText string
	args := []any{}
	switch p.Request.Kind {
	case "databases":
		sqlText = "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
	case "schemas":
		sqlText = "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog','information_schema') ORDER BY schema_name"
	case "relations":
		sqlText = "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name"
		args = []any{p.Request.Namespace}
	case "columns":
		sqlText = kingbaseColumnsQuery()
		args = []any{p.Request.Namespace, p.Request.Relation}
	default:
		return map[string]any{"kind": "metadata", "value": []any{}}, nil
	}
	rows, err := db.Query(sqlText, args...)
	if err != nil {
		return nil, fail("METADATA_FAILED", err.Error())
	}
	defer rows.Close()
	out := []any{}
	for rows.Next() {
		var first, second, third string
		var fourth sql.NullString
		switch p.Request.Kind {
		case "databases", "schemas":
			if err := rows.Scan(&first); err != nil {
				return nil, fail("METADATA_FAILED", err.Error())
			}
			out = append(out, first)
		case "relations":
			if err := rows.Scan(&first, &second); err != nil {
				return nil, fail("METADATA_FAILED", err.Error())
			}
			out = append(out, map[string]any{"name": first, "schema": p.Request.Namespace, "type": second, "comment": nil})
		case "columns":
			var primary, unique bool
			if err := rows.Scan(&first, &second, &third, &fourth, &primary, &unique); err != nil {
				return nil, fail("METADATA_FAILED", err.Error())
			}
			out = append(out, map[string]any{"name": first, "data_type": second, "is_nullable": third == "YES", "is_primary_key": primary, "is_unique": unique, "is_indexed": primary || unique, "is_auto_increment": false, "default_value": nullable(fourth), "comment": nil})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fail("METADATA_FAILED", err.Error())
	}
	return map[string]any{"kind": "metadata", "value": out}, nil
}

func kingbaseColumnsQuery() string {
	return `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default,
  EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_catalog = tc.constraint_catalog AND kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name
    WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND kcu.column_name = c.column_name
      AND tc.constraint_type = 'PRIMARY KEY'
  ) AS is_primary_key,
  EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_catalog = tc.constraint_catalog AND kcu.constraint_schema = tc.constraint_schema
      AND kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name
    WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND kcu.column_name = c.column_name
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  ) AS is_unique
FROM information_schema.columns c
WHERE c.table_schema = $1 AND c.table_name = $2
ORDER BY c.ordinal_position`
}

// listKingbaseIndexes uses the same catalog shape as the DBX native agent.
// Kingbase releases expose either sys_catalog or PostgreSQL-compatible
// pg_catalog names, so the query falls back only when the first catalog is
// unavailable. Parameters keep schema and relation names out of SQL text.
func listKingbaseIndexes(db *sql.DB, schema, table string) ([]any, error) {
	if strings.TrimSpace(schema) == "" || strings.TrimSpace(table) == "" {
		return []any{}, nil
	}
	var rows *sql.Rows
	var err error
	for _, catalog := range []string{"sys_catalog.sys", "pg_catalog.pg"} {
		rows, err = db.Query(kingbaseIndexCatalogQuery(catalog), schema, table)
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type indexEntry struct {
		name, kind      string
		unique, primary bool
		columns         []string
	}
	byName := map[string]*indexEntry{}
	order := []string{}
	for rows.Next() {
		var name, kind, columnName string
		var unique, primary bool
		var ordinal int
		if err := rows.Scan(&name, &kind, &unique, &primary, &columnName, &ordinal); err != nil {
			return nil, err
		}
		item := byName[name]
		if item == nil {
			item = &indexEntry{name: name, kind: kind, unique: unique, primary: primary, columns: []string{}}
			byName[name] = item
			order = append(order, name)
		}
		item.columns = append(item.columns, columnName)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]any, 0, len(order))
	for _, name := range order {
		item := byName[name]
		out = append(out, map[string]any{
			"name": item.name, "columns": item.columns, "is_unique": item.unique, "is_primary": item.primary,
			"filter": nil, "index_type": item.kind, "included_columns": []string{}, "comment": nil,
		})
	}
	return out, nil
}

func kingbaseIndexCatalogQuery(catalog string) string {
	return fmt.Sprintf(`SELECT i.relname, am.amname, ix.indisunique, ix.indisprimary, a.attname, pos.n
FROM %s_index ix JOIN %s_class t ON t.oid = ix.indrelid
JOIN %s_class i ON i.oid = ix.indexrelid JOIN %s_namespace n ON n.oid = t.relnamespace
JOIN %s_am am ON am.oid = i.relam
JOIN unnest(ix.indkey) WITH ORDINALITY AS pos(attnum,n) ON true
JOIN %s_attribute a ON a.attrelid = t.oid AND a.attnum = pos.attnum
WHERE n.nspname = $1 AND t.relname = $2 ORDER BY i.relname, pos.n`, catalog, catalog, catalog, catalog, catalog, catalog)
}

// listKingbaseConstraints deliberately uses information_schema for the v1
// sidecar contract. It preserves the portable fields consumed by the desktop
// (keys, referenced relation and actions) without fabricating catalog-only
// state such as validation or enablement flags.
func listKingbaseConstraints(db *sql.DB, schema, table string) ([]any, error) {
	if strings.TrimSpace(schema) == "" || strings.TrimSpace(table) == "" {
		return []any{}, nil
	}
	rows, err := db.Query(kingbaseConstraintsQuery(), schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type constraintEntry struct {
		name, kind                        string
		columns, referencedColumns        []string
		referencedSchema, referencedTable string
		onUpdate, onDelete, definition    string
	}
	byName := map[string]*constraintEntry{}
	order := []string{}
	for rows.Next() {
		var name, kind string
		var column, refSchema, refTable, refColumn, onUpdate, onDelete, definition sql.NullString
		if err := rows.Scan(&name, &kind, &column, &refSchema, &refTable, &refColumn, &onUpdate, &onDelete, &definition); err != nil {
			return nil, err
		}
		item := byName[name]
		if item == nil {
			item = &constraintEntry{name: name, kind: kind, columns: []string{}, referencedColumns: []string{}}
			byName[name] = item
			order = append(order, name)
		}
		if column.Valid && column.String != "" {
			item.columns = append(item.columns, column.String)
		}
		if refColumn.Valid && refColumn.String != "" {
			item.referencedColumns = append(item.referencedColumns, refColumn.String)
		}
		if refSchema.Valid {
			item.referencedSchema = refSchema.String
		}
		if refTable.Valid {
			item.referencedTable = refTable.String
		}
		if onUpdate.Valid {
			item.onUpdate = onUpdate.String
		}
		if onDelete.Valid {
			item.onDelete = onDelete.String
		}
		if definition.Valid {
			item.definition = definition.String
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]any, 0, len(order))
	for _, name := range order {
		item := byName[name]
		out = append(out, map[string]any{
			"name": item.name, "constraint_type": item.kind, "columns": item.columns,
			"referenced_schema": optionalText(item.referencedSchema), "referenced_table": optionalText(item.referencedTable),
			"referenced_columns": item.referencedColumns, "definition": optionalText(item.definition),
			"on_update": optionalText(item.onUpdate), "on_delete": optionalText(item.onDelete),
		})
	}
	return out, nil
}

func kingbaseConstraintsQuery() string {
	return `SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
  ccu.table_schema, ccu.table_name, ccu.column_name, rc.update_rule, rc.delete_rule, cc.check_clause
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_catalog = tc.constraint_catalog AND kcu.constraint_schema = tc.constraint_schema
  AND kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name
LEFT JOIN information_schema.referential_constraints rc
  ON rc.constraint_catalog = tc.constraint_catalog AND rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
LEFT JOIN information_schema.key_column_usage ccu
  ON ccu.constraint_catalog = rc.unique_constraint_catalog AND ccu.constraint_schema = rc.unique_constraint_schema
  AND ccu.constraint_name = rc.unique_constraint_name AND ccu.ordinal_position = kcu.position_in_unique_constraint
LEFT JOIN information_schema.check_constraints cc
  ON cc.constraint_catalog = tc.constraint_catalog AND cc.constraint_schema = tc.constraint_schema AND cc.constraint_name = tc.constraint_name
WHERE tc.table_schema = $1 AND tc.table_name = $2
ORDER BY tc.constraint_name, kcu.ordinal_position`
}

func listKingbaseReferencingForeignKeys(db *sql.DB, schema, table string) ([]any, error) {
	if strings.TrimSpace(schema) == "" || strings.TrimSpace(table) == "" {
		return []any{}, nil
	}
	rows, err := db.Query(kingbaseReferencingForeignKeysQuery(), schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type foreignKeyEntry struct {
		name, sourceSchema, sourceTable, referencedSchema, referencedTable string
		columns, referencedColumns                                         []string
	}
	byKey := map[string]*foreignKeyEntry{}
	order := []string{}
	for rows.Next() {
		var name, sourceSchema, sourceTable, column, referencedSchema, referencedTable, referencedColumn string
		if err := rows.Scan(&name, &sourceSchema, &sourceTable, &column, &referencedSchema, &referencedTable, &referencedColumn); err != nil {
			return nil, err
		}
		key := sourceSchema + "\x00" + sourceTable + "\x00" + name
		item := byKey[key]
		if item == nil {
			item = &foreignKeyEntry{name: name, sourceSchema: sourceSchema, sourceTable: sourceTable, referencedSchema: referencedSchema, referencedTable: referencedTable, columns: []string{}, referencedColumns: []string{}}
			byKey[key] = item
			order = append(order, key)
		}
		item.columns = append(item.columns, column)
		item.referencedColumns = append(item.referencedColumns, referencedColumn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]any, 0, len(order))
	for _, key := range order {
		item := byKey[key]
		out = append(out, map[string]any{
			"name": item.name, "schema": item.sourceSchema, "table": item.sourceTable, "columns": item.columns,
			"referenced_schema": item.referencedSchema, "referenced_table": item.referencedTable, "referenced_columns": item.referencedColumns,
		})
	}
	return out, nil
}

func kingbaseReferencingForeignKeysQuery() string {
	return `SELECT fk.constraint_name, fk.table_schema, fk.table_name, fk.column_name,
  pk.table_schema, pk.table_name, pk.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage fk
  ON fk.constraint_catalog = tc.constraint_catalog AND fk.constraint_schema = tc.constraint_schema
  AND fk.constraint_name = tc.constraint_name AND fk.table_schema = tc.table_schema AND fk.table_name = tc.table_name
JOIN information_schema.referential_constraints rc
  ON rc.constraint_catalog = tc.constraint_catalog AND rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
JOIN information_schema.key_column_usage pk
  ON pk.constraint_catalog = rc.unique_constraint_catalog AND pk.constraint_schema = rc.unique_constraint_schema
  AND pk.constraint_name = rc.unique_constraint_name AND pk.ordinal_position = fk.position_in_unique_constraint
WHERE tc.constraint_type = 'FOREIGN KEY' AND pk.table_schema = $1 AND pk.table_name = $2
ORDER BY fk.table_schema, fk.table_name, fk.constraint_name, fk.ordinal_position`
}

func listKingbaseRoutines(db *sql.DB, schema string) ([]any, error) {
	if strings.TrimSpace(schema) == "" {
		return []any{}, nil
	}
	rows, err := db.Query(`SELECT routine_name, routine_type, data_type, routine_comment
FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []any{}
	for rows.Next() {
		var name string
		var kind, returnType, description sql.NullString
		if err := rows.Scan(&name, &kind, &returnType, &description); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"name": name, "routine_type": optionalText(kind.String), "parameters": []any{},
			"return_type": valueOrUnknown(returnType), "description": optionalText(description.String),
		})
	}
	return out, rows.Err()
}

// listKingbaseSchemaObjects is intentionally descriptor-only. Relations stay
// in the normal table tree; this endpoint exposes only the non-relation
// families that DBX presents alongside it. The v1 package does not claim
// expandable members until a catalog-backed member reader is implemented.
func listKingbaseSchemaObjects(db *sql.DB, schema string) ([]any, error) {
	if strings.TrimSpace(schema) == "" {
		return []any{}, nil
	}
	out := []any{}
	routines, err := listKingbaseRoutines(db, schema)
	if err != nil {
		return nil, err
	}
	for _, raw := range routines {
		routine := raw.(map[string]any)
		objectType, _ := routine["routine_type"].(string)
		if strings.TrimSpace(objectType) == "" {
			objectType = "FUNCTION"
		}
		out = append(out, map[string]any{
			"name": routine["name"], "schema": schema, "object_type": objectType,
			"parent_name": nil, "comment": routine["description"], "members_expandable": false,
		})
	}
	triggerRows, err := db.Query(`SELECT trigger_name, event_object_table
FROM information_schema.triggers WHERE trigger_schema = $1 ORDER BY trigger_name`, schema)
	if err != nil {
		return nil, err
	}
	for triggerRows.Next() {
		var name, parent string
		if err := triggerRows.Scan(&name, &parent); err != nil {
			_ = triggerRows.Close()
			return nil, err
		}
		out = append(out, map[string]any{
			"name": name, "schema": schema, "object_type": "TRIGGER", "parent_name": parent,
			"comment": nil, "members_expandable": false,
		})
	}
	if err := triggerRows.Err(); err != nil {
		_ = triggerRows.Close()
		return nil, err
	}
	if err := triggerRows.Close(); err != nil {
		return nil, err
	}
	typeRows, err := db.Query(`SELECT user_defined_type_name
FROM information_schema.user_defined_types WHERE user_defined_type_schema = $1 ORDER BY user_defined_type_name`, schema)
	if err != nil {
		return nil, err
	}
	defer typeRows.Close()
	for typeRows.Next() {
		var name string
		if err := typeRows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"name": name, "schema": schema, "object_type": "TYPE", "parent_name": nil,
			"comment": nil, "members_expandable": false,
		})
	}
	return out, typeRows.Err()
}

func optionalText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func valueOrUnknown(value sql.NullString) string {
	if value.Valid && strings.TrimSpace(value.String) != "" {
		return value.String
	}
	return "UNKNOWN"
}

func nullable(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}
func jsonValue(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case []byte:
		return "base64:" + base64.StdEncoding.EncodeToString(v)
	case time.Time:
		return v.Format("2006-01-02 15:04:05.999999999")
	default:
		return v
	}
}
func statementType(sql string) string {
	fields := strings.Fields(strings.TrimSpace(sql))
	if len(fields) == 0 {
		return "UNKNOWN"
	}
	return strings.ToUpper(fields[0])
}
func rowReturning(kind string) bool {
	switch kind {
	case "SELECT", "WITH", "EXPLAIN", "SHOW", "DESCRIBE", "VALUES":
		return true
	}
	return false
}
func readOnly(sql string) bool {
	tokens := sqlTokens(sql)
	if len(tokens) == 0 || !rowReturning(strings.ToUpper(tokens[0])) {
		return false
	}
	semicolons := 0
	for _, token := range tokens {
		if token == ";" {
			semicolons++
			continue
		}
		switch token {
		case "insert", "update", "delete", "merge", "create", "alter", "drop", "truncate", "copy", "call", "begin", "commit", "rollback", "grant", "revoke":
			return false
		}
	}
	return semicolons <= 1 && (semicolons == 0 || tokens[len(tokens)-1] == ";")
}

// sqlTokens is intentionally conservative and independent from Host parsing:
// it never treats words inside strings, quoted identifiers or comments as SQL
// operations. A package-side Agent read guard must not rely on a renderer or
// Host parser remaining correct.
func sqlTokens(sql string) []string {
	bytes := []byte(sql)
	tokens := []string{}
	for i := 0; i < len(bytes); {
		switch bytes[i] {
		case '\'', '"':
			quote := bytes[i]
			i++
			for i < len(bytes) {
				if bytes[i] == quote {
					i++
					if i < len(bytes) && bytes[i] == quote {
						i++
						continue
					}
					break
				}
				i++
			}
		case '-':
			if i+1 < len(bytes) && bytes[i+1] == '-' {
				i += 2
				for i < len(bytes) && bytes[i] != '\n' {
					i++
				}
			} else {
				i++
			}
		case '/':
			if i+1 < len(bytes) && bytes[i+1] == '*' {
				i += 2
				for i+1 < len(bytes) && !(bytes[i] == '*' && bytes[i+1] == '/') {
					i++
				}
				if i+1 < len(bytes) {
					i += 2
				}
			} else {
				i++
			}
		case ';':
			tokens = append(tokens, ";")
			i++
		default:
			if (bytes[i] >= 'a' && bytes[i] <= 'z') || (bytes[i] >= 'A' && bytes[i] <= 'Z') || bytes[i] == '_' {
				start := i
				i++
				for i < len(bytes) && ((bytes[i] >= 'a' && bytes[i] <= 'z') || (bytes[i] >= 'A' && bytes[i] <= 'Z') || (bytes[i] >= '0' && bytes[i] <= '9') || bytes[i] == '_') {
					i++
				}
				tokens = append(tokens, strings.ToLower(string(bytes[start:i])))
			} else {
				i++
			}
		}
	}
	return tokens
}
func fail(code, message string) *protocolError {
	return &protocolError{Code: code, Message: message, Retryable: false, Details: map[string]string{}}
}

var _ = errors.New
var _ = fmt.Sprintf
