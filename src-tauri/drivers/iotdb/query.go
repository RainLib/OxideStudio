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
