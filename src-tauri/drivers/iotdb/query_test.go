package iotdb

import "testing"

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
