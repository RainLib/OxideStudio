package iotdb

import "testing"

func TestReadOnlyStatementRejectsDataModifyingCTEsAndMultipleStatements(t *testing.T) {
	for _, statement := range []string{
		"WITH removed AS (DELETE FROM metrics RETURNING *) SELECT * FROM removed",
		"SELECT 1; DELETE FROM metrics",
		"USE metrics",
	} {
		if IsReadOnlyStatement(statement) {
			t.Fatalf("expected read-only rejection: %s", statement)
		}
	}
	for _, statement := range []string{
		"SELECT * FROM metrics",
		"WITH recent AS (SELECT * FROM metrics) SELECT * FROM recent;",
		"SHOW DATABASES",
		"/* UPDATE metrics */ SELECT 'DELETE FROM metrics'",
	} {
		if !IsReadOnlyStatement(statement) {
			t.Fatalf("expected read-only acceptance: %s", statement)
		}
	}
}

func TestIoTDBQueryStatementClassification(t *testing.T) {
	for _, statement := range []string{"SELECT * FROM root.db.d1", "SHOW DATABASES", "DESC metrics", "WITH x AS (SELECT 1) SELECT * FROM x"} {
		if !IsQueryStatement(statement) {
			t.Fatalf("expected query: %s", statement)
		}
	}
	for _, statement := range []string{"INSERT INTO metrics(time) VALUES (1)", "CREATE DATABASE db", "SET SQL_DIALECT=TABLE"} {
		if IsQueryStatement(statement) {
			t.Fatalf("expected non-query: %s", statement)
		}
	}
}

func TestIoTDBQueryRejectsMutationBeforeOpeningACursor(t *testing.T) {
	result, err := (*Session)(nil).Query(nil, "CREATE DATABASE metrics", 1, "ms")
	if err == nil || result.Columns != nil {
		t.Fatalf("expected mutation rejection, got result=%#v err=%v", result, err)
	}
}
