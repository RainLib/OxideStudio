package iotdb

import (
	"context"
	"fmt"
	"strings"

	"github.com/apache/iotdb-client-go/v2/client"
)

const MaxQueryRows = 10000

type QueryResult struct {
	Columns      []string
	ColumnTypes  []string
	Rows         [][]any
	Truncated    bool
	RowsAffected uint64
}

// QueryCursor owns one native IoTDB result set until it is exhausted or
// closed. It provides true cursor pagination: the sidecar never rewrites a
// caller's statement with dialect-specific LIMIT/OFFSET clauses.
//
// A Session is intentionally single-flight while a cursor is open. The
// sidecar serializes access to it because SessionDataSet is backed by the same
// native session socket as ordinary statements.
type QueryCursor struct {
	data        *client.SessionDataSet
	columns     []string
	columnTypes []string
	prefetched  []any
	exhausted   bool
}

// Query uses the native IoTDB result cursor directly. The sidecar owns the
// bounded read, so a malformed or unexpectedly large server response cannot
// force the desktop Host to materialize unlimited rows over IPC.
func (s *Session) Query(ctx context.Context, statement string, limit int, precision string) (QueryResult, error) {
	cursor, err := s.OpenQueryCursor(ctx, statement, precision)
	if err != nil {
		return QueryResult{}, err
	}
	defer cursor.Close()
	result, _, err := cursor.ReadPage(ctx, limit)
	return result, err
}

// OpenQueryCursor starts a read-only native result set. The returned cursor
// must be closed by the caller, including cancellation and disconnect paths.
func (s *Session) OpenQueryCursor(ctx context.Context, statement, precision string) (*QueryCursor, error) {
	statement = strings.TrimSpace(strings.TrimRight(strings.TrimSpace(statement), ";"))
	if statement == "" {
		return nil, fmt.Errorf("IoTDB statement is required")
	}
	if !IsQueryStatement(statement) {
		return nil, fmt.Errorf("IoTDB package only permits read-only query statements")
	}
	data, err := s.Execute(ctx, statement)
	if err != nil {
		return nil, err
	}
	if data == nil {
		return &QueryCursor{exhausted: true}, nil
	}
	columns := append([]string(nil), data.GetColumnNames()...)
	return &QueryCursor{
		data:        data,
		columns:     columns,
		columnTypes: NormalizeColumnTypes(data.GetColumnTypes(), columns, s.config.Dialect, precision),
	}, nil
}

// ReadPage reads at most limit rows and probes exactly one additional row to
// report whether another page exists. The probe remains inside the cursor, so
// no result is lost between pages.
func (c *QueryCursor) ReadPage(ctx context.Context, limit int) (QueryResult, bool, error) {
	if err := ctx.Err(); err != nil {
		return QueryResult{}, false, err
	}
	if limit < 1 || limit > MaxQueryRows {
		limit = MaxQueryRows
	}
	if c == nil {
		return QueryResult{Rows: make([][]any, 0, limit)}, false, nil
	}
	result := QueryResult{Columns: append([]string(nil), c.columns...), ColumnTypes: append([]string(nil), c.columnTypes...), Rows: make([][]any, 0, limit)}
	if c.exhausted || c.data == nil {
		return result, false, nil
	}
	if c.prefetched != nil {
		result.Rows = append(result.Rows, c.prefetched)
		c.prefetched = nil
	}
	for len(result.Rows) < limit {
		row, ok, err := c.next(ctx)
		if err != nil {
			return QueryResult{}, false, err
		}
		if !ok {
			return result, false, nil
		}
		result.Rows = append(result.Rows, row)
	}
	row, ok, err := c.next(ctx)
	if err != nil {
		return QueryResult{}, false, err
	}
	if !ok {
		return result, false, nil
	}
	c.prefetched = row
	return result, true, nil
}

func (c *QueryCursor) next(ctx context.Context) ([]any, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	hasNext, err := c.data.Next()
	if err != nil {
		return nil, false, err
	}
	if !hasNext {
		c.exhausted = true
		return nil, false, nil
	}
	row := make([]any, len(c.columns))
	for index := range c.columns {
		value, err := c.data.GetObjectByIndex(int32(index + 1))
		if err != nil {
			return nil, false, err
		}
		row[index] = NormalizeValue(value, c.columnTypes[index])
	}
	return row, true, nil
}

func (c *QueryCursor) Close() error {
	if c == nil || c.data == nil {
		return nil
	}
	data := c.data
	c.data = nil
	c.exhausted = true
	c.prefetched = nil
	return data.Close()
}

func IsQueryStatement(statement string) bool {
	fields := strings.Fields(strings.TrimSpace(statement))
	if len(fields) == 0 {
		return false
	}
	switch strings.ToUpper(fields[0]) {
	case "SELECT", "SHOW", "DESC", "DESCRIBE", "EXPLAIN", "WITH":
		return true
	}
	return false
}

// IsReadOnlyStatement is the package-side safety gate used when the Host
// marks an external-driver request as read-only. A leading WITH is not enough:
// it can legally contain a data-modifying CTE. The scanner deliberately
// ignores quoted text and comments, rejects multi-statements, and fails closed
// for every mutation or transaction keyword it can observe.
func IsReadOnlyStatement(statement string) bool {
	tokens := iotdbSQLTokens(statement)
	if len(tokens) == 0 {
		return false
	}
	first := tokens[0]
	switch first {
	case "select", "show", "desc", "describe", "explain", "with":
	default:
		return false
	}
	semicolons := 0
	hasSelect := first == "select"
	for _, token := range tokens {
		if token == ";" {
			semicolons++
			continue
		}
		if token == "select" {
			hasSelect = true
		}
		switch token {
		case "insert", "update", "delete", "merge", "create", "alter", "drop", "truncate", "grant", "revoke", "call", "begin", "commit", "rollback", "set", "use":
			return false
		}
	}
	if semicolons > 1 || semicolons == 1 && tokens[len(tokens)-1] != ";" {
		return false
	}
	return first != "with" || hasSelect
}

func iotdbSQLTokens(statement string) []string {
	bytes := []byte(statement)
	tokens := []string{}
	for index := 0; index < len(bytes); {
		switch bytes[index] {
		case '\'', '"', '`':
			quote := bytes[index]
			index++
			for index < len(bytes) {
				if bytes[index] == quote {
					index++
					if index < len(bytes) && bytes[index] == quote {
						index++
						continue
					}
					break
				}
				index++
			}
		case '-':
			if index+1 < len(bytes) && bytes[index+1] == '-' {
				index += 2
				for index < len(bytes) && bytes[index] != '\n' {
					index++
				}
			} else {
				index++
			}
		case '/':
			if index+1 < len(bytes) && bytes[index+1] == '*' {
				index += 2
				for index+1 < len(bytes) && !(bytes[index] == '*' && bytes[index+1] == '/') {
					index++
				}
				if index+1 < len(bytes) {
					index += 2
				}
			} else {
				index++
			}
		case ';':
			tokens = append(tokens, ";")
			index++
		default:
			if bytes[index] >= 'a' && bytes[index] <= 'z' || bytes[index] >= 'A' && bytes[index] <= 'Z' || bytes[index] == '_' {
				start := index
				index++
				for index < len(bytes) && ((bytes[index] >= 'a' && bytes[index] <= 'z') || (bytes[index] >= 'A' && bytes[index] <= 'Z') || (bytes[index] >= '0' && bytes[index] <= '9') || bytes[index] == '_') {
					index++
				}
				tokens = append(tokens, strings.ToLower(string(bytes[start:index])))
			} else {
				index++
			}
		}
	}
	return tokens
}
