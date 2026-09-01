package iotdb

import (
	"fmt"
	"strings"
)

// AdaptMetadata converts the bounded native query result into the exact
// metadata shapes deserialized by Oxide's external driver. It deliberately
// emits only fields IoTDB proves; absent index/constraint information remains
// an empty list instead of inferred schema state.
func AdaptMetadata(kind, schema, relation string, result QueryResult) (any, error) {
	switch kind {
	case "databases", "schemas":
		values := make([]string, 0, len(result.Rows))
		for _, row := range result.Rows {
			if len(row) > 0 {
				if value := stringValue(row[0]); value != "" {
					values = append(values, value)
				}
			}
		}
		return values, nil
	case "relations":
		items := make([]map[string]any, 0, len(result.Rows))
		nameIndex := columnIndex(result.Columns, "TableName", "table_name", "Device")
		typeIndex := columnIndex(result.Columns, "TableType", "table_type")
		for _, row := range result.Rows {
			name := relativeTreeName(schema, rowValue(row, nameIndex))
			if name == "" {
				continue
			}
			item := map[string]any{"name": name, "schema": nullable(schema), "type": "TABLE", "comment": nil}
			if typ := rowValue(row, typeIndex); typ != "" {
				item["type"] = typ
			}
			items = append(items, item)
		}
		return items, nil
	case "columns":
		items := make([]map[string]any, 0, len(result.Rows))
		nameIndex := columnIndex(result.Columns, "ColumnName", "column_name", "Timeseries")
		typeIndex := columnIndex(result.Columns, "DataType", "data_type")
		for _, row := range result.Rows {
			name := relativeTreeName(joinTreePath(schema, relation), rowValue(row, nameIndex))
			if name == "" {
				continue
			}
			typ := rowValue(row, typeIndex)
			if typ == "" {
				typ = "UNKNOWN"
			}
			items = append(items, map[string]any{"name": name, "data_type": typ, "is_nullable": true, "is_primary_key": false, "is_unique": false, "is_indexed": false, "is_auto_increment": false, "default_value": nil, "comment": nil})
		}
		return items, nil
	case "indexes", "constraints", "referencingForeignKeys", "routines", "schemaObjects", "schemaObjectMembers", "collections":
		return []any{}, nil
	default:
		return nil, fmt.Errorf("unsupported IoTDB metadata result: %s", kind)
	}
}

func joinTreePath(parts ...string) string {
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.Trim(strings.TrimSpace(part), "."); value != "" {
			values = append(values, value)
		}
	}
	return strings.Join(values, ".")
}

func relativeTreeName(prefix, value string) string {
	prefix = strings.Trim(strings.TrimSpace(prefix), ".")
	value = strings.TrimSpace(value)
	if prefix == "" || !strings.HasPrefix(value, prefix+".") {
		return value
	}
	return strings.TrimPrefix(value, prefix+".")
}
func columnIndex(columns []string, names ...string) int {
	for i, column := range columns {
		for _, name := range names {
			if strings.EqualFold(strings.TrimSpace(column), name) {
				return i
			}
		}
	}
	return -1
}
func rowValue(row []any, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return stringValue(row[index])
}
func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
