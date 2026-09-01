// Pure IoTDB result normalization shared by the forthcoming native sidecar.
// DBX's native driver must support both Tree and Table SQL dialects without
// exposing the Tree aggregate INT64 timestamp quirk to the Grid.
package iotdb

import (
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"time"
)

const (
	TreeDialect  = "tree"
	TableDialect = "table"
)

func NormalizeColumnTypes(types, columns []string, dialect, precision string) []string {
	result := make([]string, len(columns))
	for index := range result {
		if index < len(types) {
			result[index] = strings.ToUpper(strings.TrimSpace(types[index]))
		}
		if dialect == TreeDialect && index == 0 && strings.EqualFold(strings.TrimSpace(columns[index]), "Time") {
			result[index] = timestampType(precision)
			continue
		}
		if dialect == TreeDialect && typeBase(result[index]) == "INT64" && isTimeAggregate(columns[index]) {
			result[index] = timestampType(precision)
			continue
		}
		if typeBase(result[index]) == "TIMESTAMP" {
			result[index] = timestampType(precision)
		}
	}
	return result
}

func NormalizeValue(value any, columnType string) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		if typeBase(columnType) == "DATE" {
			return typed.Format("2006-01-02")
		}
		return typed.Format(time.RFC3339Nano)
	case []byte:
		return hex.EncodeToString(typed)
	case float32:
		if math.IsNaN(float64(typed)) || math.IsInf(float64(typed), 0) {
			return fmt.Sprint(typed)
		}
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return fmt.Sprint(typed)
		}
	}
	return value
}

func isTimeAggregate(column string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(column))
	return strings.HasPrefix(trimmed, "max_time(") || strings.HasPrefix(trimmed, "min_time(")
}
func typeBase(value string) string {
	return strings.TrimSpace(strings.SplitN(strings.ToUpper(value), "(", 2)[0])
}
func timestampType(precision string) string {
	switch strings.ToLower(strings.TrimSpace(precision)) {
	case "ms", "us", "ns":
		return "TIMESTAMP(" + strings.ToLower(strings.TrimSpace(precision)) + ")"
	}
	return "TIMESTAMP"
}
