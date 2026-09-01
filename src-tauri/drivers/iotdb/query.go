package iotdb

import (
	"context"
	"fmt"
	"strings"
)

const MaxQueryRows = 10000

type QueryResult struct {
	Columns      []string
	ColumnTypes  []string
	Rows         [][]any
	Truncated    bool
	RowsAffected uint64
}

// Query uses the native IoTDB result cursor directly. The sidecar owns the
// bounded read, so a malformed or unexpectedly large server response cannot
// force the desktop Host to materialize unlimited rows over IPC.
func (s *Session) Query(ctx context.Context, statement string, limit int, precision string) (QueryResult, error) {
	statement = strings.TrimSpace(strings.TrimRight(strings.TrimSpace(statement), ";"))
	if statement == "" {
		return QueryResult{}, fmt.Errorf("IoTDB statement is required")
	}
	if !IsQueryStatement(statement) {
		return QueryResult{}, fmt.Errorf("IoTDB package only permits read-only query statements")
	}
	data, err := s.Execute(ctx, statement)
	if err != nil {
		return QueryResult{}, err
	}
	if data == nil {
		return QueryResult{}, nil
	}
	defer data.Close()
	if limit < 1 || limit > MaxQueryRows {
		limit = MaxQueryRows
	}
	columns := append([]string(nil), data.GetColumnNames()...)
	types := NormalizeColumnTypes(data.GetColumnTypes(), columns, s.config.Dialect, precision)
	result := QueryResult{Columns: columns, ColumnTypes: types, Rows: make([][]any, 0, limit)}
	for {
		hasNext, err := data.Next()
		if err != nil {
			return QueryResult{}, err
		}
		if !hasNext {
			return result, nil
		}
		if len(result.Rows) >= limit {
			result.Truncated = true
			return result, nil
		}
		row := make([]any, len(columns))
		for index := range columns {
			value, err := data.GetObjectByIndex(int32(index + 1))
			if err != nil {
				return QueryResult{}, err
			}
			row[index] = NormalizeValue(value, types[index])
		}
		result.Rows = append(result.Rows, row)
	}
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
