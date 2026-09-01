package main

import (
	"encoding/json"
	"github.com/rainlib/oxide-driver-iotdb"
	"testing"
)

func TestProtocolColumnsUseTheHostDriverShape(t *testing.T) {
	columns := protocolColumns(iotdb.QueryResult{Columns: []string{"Time", "max_time(s1)"}, ColumnTypes: []string{"TIMESTAMP(ms)", "TIMESTAMP(ms)"}})
	if columns[0]["name"] != "Time" || columns[0]["dataType"] != "TIMESTAMP(ms)" || columns[1]["name"] != "max_time(s1)" {
		t.Fatalf("columns = %#v", columns)
	}
}

func TestQueryRejectsBoundParametersBeforeOpeningSession(t *testing.T) {
	server := &sidecar{sessions: map[string]*iotdb.Session{}}
	parameters, err := json.Marshal(map[string]any{"connection_id": "missing", "statement": "SELECT 1", "parameters": []any{1}})
	if err != nil {
		t.Fatal(err)
	}
	_, failure := server.query(parameters)
	if failure == nil || failure.Code != "PARAMETERS_UNSUPPORTED" {
		t.Fatalf("failure = %#v", failure)
	}
}
