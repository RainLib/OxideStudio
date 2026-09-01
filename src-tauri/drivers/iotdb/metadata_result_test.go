package iotdb

import "testing"

func TestAdaptMetadataForTreeAndTableResults(t *testing.T) {
	value, err := AdaptMetadata("relations", "root.factory", QueryResult{Columns: []string{"Device"}, Rows: [][]any{{"root.factory.d1"}}})
	if err != nil {
		t.Fatal(err)
	}
	relations := value.([]map[string]any)
	if relations[0]["name"] != "root.factory.d1" || relations[0]["type"] != "TABLE" {
		t.Fatalf("relations=%#v", relations)
	}
	value, err = AdaptMetadata("columns", "metrics", QueryResult{Columns: []string{"ColumnName", "DataType"}, Rows: [][]any{{"cpu", "DOUBLE"}}})
	if err != nil {
		t.Fatal(err)
	}
	columns := value.([]map[string]any)
	if columns[0]["name"] != "cpu" || columns[0]["data_type"] != "DOUBLE" {
		t.Fatalf("columns=%#v", columns)
	}
}

func TestAdaptMetadataOmitsUnprovenRows(t *testing.T) {
	value, err := AdaptMetadata("databases", "", QueryResult{Rows: [][]any{{nil}, {"metrics"}}})
	if err != nil {
		t.Fatal(err)
	}
	databases := value.([]string)
	if len(databases) != 1 || databases[0] != "metrics" {
		t.Fatalf("databases=%#v", databases)
	}
}
