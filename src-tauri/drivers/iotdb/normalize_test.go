package iotdb

import (
	"math"
	"reflect"
	"testing"
	"time"
)

func TestTreeAggregateTimestampColumnsPreserveSelectAlignment(t *testing.T) {
	got := NormalizeColumnTypes([]string{"INT64", "DOUBLE", "INT64"}, []string{"max_time(root.db.d1.s1)", "avg(s1)", "min_time(s1)"}, TreeDialect, "us")
	want := []string{"TIMESTAMP(us)", "DOUBLE", "TIMESTAMP(us)"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("types = %#v, want %#v", got, want)
	}
}

func TestOnlyTreeDialectTreatsFirstTimeColumnAsTimestamp(t *testing.T) {
	if got := NormalizeColumnTypes([]string{"INT64"}, []string{"Time"}, TableDialect, "ms"); got[0] != "INT64" {
		t.Fatalf("table type = %q", got[0])
	}
	if got := NormalizeColumnTypes([]string{"INT64"}, []string{"Time"}, TreeDialect, "ms"); got[0] != "TIMESTAMP(ms)" {
		t.Fatalf("tree type = %q", got[0])
	}
}

func TestIoTDBValueNormalizationIsJsonSafe(t *testing.T) {
	date := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	if got := NormalizeValue(date, "DATE"); got != "2026-09-02" {
		t.Fatalf("date = %#v", got)
	}
	if got := NormalizeValue([]byte{0xde, 0xad}, "BLOB"); got != "dead" {
		t.Fatalf("blob = %#v", got)
	}
	if got := NormalizeValue(math.Inf(1), "DOUBLE"); got != "+Inf" {
		t.Fatalf("infinity = %#v", got)
	}
}
