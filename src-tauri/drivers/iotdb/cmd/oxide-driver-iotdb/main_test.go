package main

import (
	"context"
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
	server := &sidecar{sessions: map[string]*sessionState{}}
	parameters, err := json.Marshal(map[string]any{"connection_id": "missing", "statement": "SELECT 1", "parameters": []any{1}})
	if err != nil {
		t.Fatal(err)
	}
	_, failure := server.query(parameters)
	if failure == nil || failure.Code != "PARAMETERS_UNSUPPORTED" {
		t.Fatalf("failure = %#v", failure)
	}
}

func TestPagedQueryRejectsInvalidBoundsBeforeOpeningSession(t *testing.T) {
	server := &sidecar{sessions: map[string]*sessionState{}}
	params, err := json.Marshal(map[string]any{
		"connection_id": "missing", "statement": "SELECT 1", "page_size": 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, failure := server.queryPage(params)
	if failure == nil || failure.Code != "INVALID_PAGE_SIZE" {
		t.Fatalf("failure = %#v", failure)
	}

	params, err = json.Marshal(map[string]any{
		"connection_id": "missing", "statement": "SELECT 1", "page_size": 10, "max_rows": iotdb.MaxQueryRows + 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, failure = server.queryPage(params)
	if failure == nil || failure.Code != "INVALID_PAGE_LIMIT" {
		t.Fatalf("failure = %#v", failure)
	}
}

func TestHandshakeAdvertisesNativeQueryPaging(t *testing.T) {
	handshake := iotdb.Handshake()
	value, ok := handshake["value"].(map[string]any)
	if !ok {
		t.Fatalf("handshake value = %#v", handshake["value"])
	}
	capabilities, ok := value["capabilities"].(map[string]any)
	if !ok || capabilities["queryPaging"] != true {
		t.Fatalf("capabilities = %#v", capabilities)
	}
}

func TestCancelOnlySignalsTheMatchingActiveQuery(t *testing.T) {
	canceled := false
	state := &sessionState{active: map[string]context.CancelFunc{
		"active": func() { canceled = true },
	}}
	if state.cancel("missing") || canceled {
		t.Fatal("unregistered query must not be canceled")
	}
	if !state.cancel("active") || !canceled {
		t.Fatal("active query was not canceled")
	}
}
