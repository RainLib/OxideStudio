package iotdb

import (
	"fmt"
	"strings"
)

// ObjectSource renders only DDL that the IoTDB metadata responses prove. It
// deliberately does not guess absent attributes: a definition that omits an
// encoding, category, comment, or TTL is worse than no definition at all.
func ObjectSource(dialect, schema, object string, columns, details QueryResult, aligned bool) (string, error) {
	schema = strings.TrimSpace(schema)
	object = strings.TrimSpace(object)
	if schema == "" || object == "" {
		return "", fmt.Errorf("IoTDB schema and object name are required")
	}
	if dialect == TableDialect {
		return tableObjectSource(schema, object, columns, details), nil
	}
	return treeObjectSource(schema, object, columns, aligned), nil
}

func tableObjectSource(schema, object string, columns, details QueryResult) string {
	definitions := make([]string, 0, len(columns.Rows))
	nameIndex := columnIndex(columns.Columns, "ColumnName", "column_name")
	typeIndex := columnIndex(columns.Columns, "DataType", "data_type")
	categoryIndex := columnIndex(columns.Columns, "Category", "category")
	commentIndex := columnIndex(columns.Columns, "Comment", "comment")
	for _, row := range columns.Rows {
		name, dataType := rowValue(row, nameIndex), rowValue(row, typeIndex)
		if name == "" || dataType == "" {
			continue
		}
		definition := "  " + quote(name) + " " + dataType
		if category := strings.ToUpper(rowValue(row, categoryIndex)); category != "" && category != "FIELD" {
			definition += " " + category
		}
		if comment := rowValue(row, commentIndex); comment != "" {
			definition += " COMMENT " + quoteSQLString(comment)
		}
		definitions = append(definitions, definition)
	}
	if len(definitions) == 0 {
		return ""
	}
	ddl := "DROP TABLE IF EXISTS " + quote(schema) + "." + quote(object) + ";\n\nCREATE TABLE " + quote(schema) + "." + quote(object) + " (\n" + strings.Join(definitions, ",\n") + "\n)"
	row := findObjectDetail(details, object)
	if comment := firstRowValue(details, row, "Comment", "comment"); comment != "" {
		ddl += " COMMENT " + quoteSQLString(comment)
	}
	if ttl := firstRowValue(details, row, "TTL(ms)", "ttl(ms)"); strings.EqualFold(ttl, "INF") {
		ddl += " WITH (TTL='INF')"
	} else if ttl != "" && isDecimal(ttl) {
		ddl += " WITH (TTL=" + ttl + ")"
	}
	return ddl + ";"
}

func treeObjectSource(schema, object string, columns QueryResult, aligned bool) string {
	device := treePath(schema, object)
	nameIndex := columnIndex(columns.Columns, "Timeseries", "timeseries")
	typeIndex := columnIndex(columns.Columns, "DataType", "data_type")
	encodingIndex := columnIndex(columns.Columns, "Encoding", "encoding")
	compressionIndex := columnIndex(columns.Columns, "Compression", "Compressor", "compression", "compressor")
	definitions := make([]string, 0, len(columns.Rows))
	for _, row := range columns.Rows {
		fullName, dataType := rowValue(row, nameIndex), rowValue(row, typeIndex)
		measurement := relativeTreeName(device, fullName)
		if measurement == "" || strings.Contains(measurement, ".") || dataType == "" {
			continue
		}
		definition := quoteTreeNode(measurement) + " " + dataType
		if encoding := rowValue(row, encodingIndex); encoding != "" {
			definition += " ENCODING=" + encoding
		}
		if compression := rowValue(row, compressionIndex); compression != "" {
			definition += " COMPRESSOR=" + compression
		}
		definitions = append(definitions, definition)
	}
	if len(definitions) == 0 {
		return ""
	}
	if aligned {
		return "CREATE ALIGNED TIMESERIES " + device + "(" + strings.Join(definitions, ", ") + ");"
	}
	statements := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		parts := strings.SplitN(definition, " ", 2)
		statements = append(statements, "CREATE TIMESERIES "+device+"."+parts[0]+" WITH DATATYPE="+strings.Replace(parts[1], " ", ", ", 1)+";")
	}
	return strings.Join(statements, "\n")
}

func findObjectDetail(result QueryResult, object string) []any {
	nameIndex := columnIndex(result.Columns, "TableName", "table_name")
	for _, row := range result.Rows {
		if rowValue(row, nameIndex) == object {
			return row
		}
	}
	return nil
}

func firstRowValue(result QueryResult, row []any, names ...string) string {
	return rowValue(row, columnIndex(result.Columns, names...))
}

func isDecimal(value string) bool {
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return value != ""
}

func quoteSQLString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
