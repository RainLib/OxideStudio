package iotdb

import (
	"strings"
	"testing"
)

func TestObjectSourceBuildsTableDDLFromProvenMetadata(t *testing.T) {
	ddl, err := ObjectSource(TableDialect, "metrics", "cpu", QueryResult{
		Columns: []string{"ColumnName", "DataType", "Category", "Comment"},
		Rows:    [][]any{{"time", "TIMESTAMP", "TIME", nil}, {"host", "STRING", "TAG", "node's host"}, {"usage", "DOUBLE", "FIELD", nil}},
	}, QueryResult{Columns: []string{"TableName", "TTL(ms)", "Comment"}, Rows: [][]any{{"cpu", "86400000", "CPU's metrics"}}}, false)
	if err != nil || !strings.Contains(ddl, "CREATE TABLE \"metrics\".\"cpu\"") || !strings.Contains(ddl, "\"host\" STRING TAG COMMENT 'node''s host'") || !strings.Contains(ddl, "WITH (TTL=86400000)") {
		t.Fatalf("ddl=%q err=%v", ddl, err)
	}
}

func TestObjectSourceBuildsTreeDDLWithoutGuessingMissingAttributes(t *testing.T) {
	ddl, err := ObjectSource(TreeDialect, "root.factory", "d1", QueryResult{
		Columns: []string{"Timeseries", "DataType", "Encoding", "Compression"},
		Rows:    [][]any{{"root.factory.d1.temp", "FLOAT", "GORILLA", "LZ4"}, {"root.factory.d1.status", "BOOLEAN", nil, nil}},
	}, QueryResult{}, true)
	if err != nil || ddl != "CREATE ALIGNED TIMESERIES root.factory.d1(temp FLOAT ENCODING=GORILLA COMPRESSOR=LZ4, status BOOLEAN);" {
		t.Fatalf("ddl=%q err=%v", ddl, err)
	}
}
