package iotdb

import "testing"

func TestAdaptMetadataForTreeAndTableResults(t *testing.T) {
	value, err := AdaptMetadata("relations", "root.factory", "", QueryResult{Columns: []string{"Device"}, Rows: [][]any{{"root.factory.d1"}}})
	if err != nil {
		t.Fatal(err)
	}
	relations := value.([]map[string]any)
	if relations[0]["name"] != "d1" || relations[0]["type"] != "TABLE" {
		t.Fatalf("relations=%#v", relations)
	}
	value, err = AdaptMetadata("columns", "metrics", "", QueryResult{Columns: []string{"ColumnName", "DataType"}, Rows: [][]any{{"cpu", "DOUBLE"}}})
	if err != nil {
		t.Fatal(err)
	}
	columns := value.([]map[string]any)
	if columns[0]["name"] != "cpu" || columns[0]["data_type"] != "DOUBLE" {
		t.Fatalf("columns=%#v", columns)
	}
}

func TestAdaptMetadataOmitsUnprovenRows(t *testing.T) {
	value, err := AdaptMetadata("databases", "", "", QueryResult{Rows: [][]any{{nil}, {"metrics"}}})
	if err != nil {
		t.Fatal(err)
	}
	databases := value.([]string)
	if len(databases) != 1 || databases[0] != "metrics" {
		t.Fatalf("databases=%#v", databases)
	}
}

func TestAdaptMetadataReturnsTreeColumnsRelativeToTheSelectedDevice(t *testing.T) {
	value, err := AdaptMetadata("columns", "root.factory", "d1", QueryResult{Columns: []string{"Timeseries", "DataType"}, Rows: [][]any{{"root.factory.d1.temperature", "FLOAT"}}})
	if err != nil {
		t.Fatal(err)
	}
	columns := value.([]map[string]any)
	if len(columns) != 1 || columns[0]["name"] != "temperature" {
		t.Fatalf("columns=%#v", columns)
	}
}

func TestAdaptMetadataTableColumnsPreserveTimeAndTagKeys(t *testing.T) {
	value, err := AdaptMetadata("columns", "metrics", "cpu", QueryResult{
		Columns: []string{"ColumnName", "DataType", "Category", "Comment"},
		Rows:    [][]any{{"time", "TIMESTAMP", "TIME", nil}, {"host", "STRING", "TAG", "node identity"}, {"usage", "DOUBLE", "FIELD", nil}},
	})
	if err != nil {
		t.Fatal(err)
	}
	items := value.([]map[string]any)
	if !items[0]["is_primary_key"].(bool) || !items[1]["is_primary_key"].(bool) || items[2]["is_primary_key"].(bool) {
		t.Fatalf("unexpected IoTDB table keys: %#v", items)
	}
	if items[1]["comment"] != "node identity" {
		t.Fatalf("table comment was not preserved: %#v", items[1])
	}
}
