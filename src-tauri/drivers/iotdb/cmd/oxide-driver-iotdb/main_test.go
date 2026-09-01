package main

import (
	"github.com/rainlib/oxide-driver-iotdb"
	"testing"
)

func TestProtocolColumnsUseTheHostDriverShape(t *testing.T) {
	columns := protocolColumns(iotdb.QueryResult{Columns: []string{"Time", "max_time(s1)"}, ColumnTypes: []string{"TIMESTAMP(ms)", "TIMESTAMP(ms)"}})
	if columns[0]["name"] != "Time" || columns[0]["dataType"] != "TIMESTAMP(ms)" || columns[1]["name"] != "max_time(s1)" {
		t.Fatalf("columns = %#v", columns)
	}
}
