package iotdb

import "testing"

func TestMetadataStatementUsesTheCorrectIoTDBDialect(t *testing.T) {
	statement, err := MetadataStatement(TreeDialect, "relations", "root.factory", "")
	if err != nil || statement != "SHOW DEVICES `root.factory`.**" {
		t.Fatalf("tree relations = %q, %v", statement, err)
	}
	statement, err = MetadataStatement(TableDialect, "relations", "metrics", "")
	if err != nil || statement != `SHOW TABLES DETAILS FROM "metrics"` {
		t.Fatalf("table relations = %q, %v", statement, err)
	}
	statement, err = MetadataStatement(TableDialect, "columns", "metrics", "cpu\"load")
	if err != nil || statement != `DESC "metrics"."cpu""load" DETAILS` {
		t.Fatalf("table columns = %q, %v", statement, err)
	}
}

func TestMetadataStatementRejectsMissingAndUnknownTargets(t *testing.T) {
	if _, err := MetadataStatement(TreeDialect, "columns", "root.db", ""); err == nil {
		t.Fatal("expected relation rejection")
	}
	if _, err := MetadataStatement(TreeDialect, "drop", "root.db", "device"); err == nil {
		t.Fatal("expected kind rejection")
	}
}
