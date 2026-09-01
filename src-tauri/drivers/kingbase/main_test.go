package main

import (
	"reflect"
	"testing"
	"time"
)

func TestReadOnlyGateRejectsMutationButIgnoresQuotedText(t *testing.T) {
	for _, sql := range []string{
		"DELETE FROM audit_log",
		"WITH removed AS (DELETE FROM audit_log RETURNING id) SELECT * FROM removed",
		"SELECT 1; DELETE FROM audit_log",
		"/* UPDATE audit_log */ SELECT 1; SELECT 2",
	} {
		if readOnly(sql) {
			t.Fatalf("expected rejection: %s", sql)
		}
	}
	for _, sql := range []string{
		"SELECT 'DELETE FROM audit_log' AS note;",
		"-- DELETE FROM audit_log\nSELECT 1",
		"SELECT \"update\" FROM audit_log",
	} {
		if !readOnly(sql) {
			t.Fatalf("expected read-only acceptance: %s", sql)
		}
	}
}

func TestSqlTokensDoNotExposeQuotedOrCommentKeywords(t *testing.T) {
	got := sqlTokens("SELECT 'drop', \"delete\" /* update */ FROM metrics;")
	want := []string{"select", "from", "metrics", ";"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tokens = %#v, want %#v", got, want)
	}
}

func TestKingbaseTimestampKeepsItsWallClockRepresentation(t *testing.T) {
	instant := time.Date(2026, time.September, 2, 9, 30, 0, 123456000, time.FixedZone("CST", 8*3600))
	if got, want := jsonValue(instant), "2026-09-02 09:30:00.123456"; got != want {
		t.Fatalf("timestamp = %#v, want %q", got, want)
	}
}
