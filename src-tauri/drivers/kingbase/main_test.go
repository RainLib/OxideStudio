package main

import (
	"context"
	"database/sql"
	"reflect"
	"strings"
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

func TestKingbaseIndexCatalogQueryUsesBoundIdentifiers(t *testing.T) {
	query := kingbaseIndexCatalogQuery("sys_catalog.sys")
	if !strings.Contains(query, "n.nspname = $1 AND t.relname = $2") || strings.Contains(query, "%s") {
		t.Fatalf("index query must use bound identifiers: %s", query)
	}
}

func TestKingbaseMetadataQueriesUseBoundScope(t *testing.T) {
	for _, query := range []string{kingbaseConstraintsQuery(), kingbaseRoutinesQuery()} {
		if !strings.Contains(query, "$1") || strings.Contains(query, "%s") {
			t.Fatalf("metadata query must bind its scope: %s", query)
		}
	}
}

func TestKingbaseRoutinesQueryKeepsOverloadsAndInputParameters(t *testing.T) {
	query := kingbaseRoutinesQuery()
	for _, expected := range []string{"r.specific_name", "p.specific_name = r.specific_name", "p.parameter_mode IN ('IN', 'INOUT', 'VARIADIC')", "ORDER BY r.routine_name, r.specific_name, p.ordinal_position"} {
		if !strings.Contains(query, expected) {
			t.Fatalf("routine query missing %q: %s", expected, query)
		}
	}
}

func TestKingbaseSchemaObjectQueriesUseBoundScope(t *testing.T) {
	for _, query := range []string{
		`SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema = $1`,
		`SELECT user_defined_type_name FROM information_schema.user_defined_types WHERE user_defined_type_schema = $1`,
	} {
		if !strings.Contains(query, "$1") {
			t.Fatalf("schema-object query must bind its namespace: %s", query)
		}
	}
}

func TestKingbaseTypeMemberQueriesUseBoundIdentifiers(t *testing.T) {
	for _, query := range []string{kingbaseCompositeTypeMembersQuery(), kingbaseEnumTypeMembersQuery()} {
		if !strings.Contains(query, "$1") || !strings.Contains(query, "$2") || strings.Contains(query, "%s") {
			t.Fatalf("type-member query must bind schema and type: %s", query)
		}
	}
}

func TestKingbaseDomainSourceQueryUsesBoundIdentifiersAndCatalogDeparsers(t *testing.T) {
	for _, catalog := range []string{"pg_catalog.pg", "sys_catalog.sys"} {
		query := kingbaseDomainTypeQuery(catalog)
		if !strings.Contains(query, "$1") || !strings.Contains(query, "$2") || strings.Contains(query, "%s") {
			t.Fatalf("domain source query must bind schema and type: %s", query)
		}
		if !strings.Contains(query, kingbaseCatalogDeparser(catalog, "get_expr")) || !strings.Contains(query, kingbaseCatalogDeparser(catalog, "get_constraintdef")) {
			t.Fatalf("domain source query must use one catalog family: %s", query)
		}
	}
}

func TestKingbaseObjectSourceQueriesUseBoundIdentifiers(t *testing.T) {
	for _, query := range []string{kingbaseViewSourceQuery(), kingbaseRoutineSourceQuery(), kingbaseTriggerSourceQuery()} {
		if !strings.Contains(query, "$1") || !strings.Contains(query, "$2") || strings.Contains(query, "%s") {
			t.Fatalf("object-source query must bind schema and object name: %s", query)
		}
	}
	if !strings.Contains(kingbaseTriggerSourceQuery(), "$3") {
		t.Fatalf("trigger source query must bind the trigger name: %s", kingbaseTriggerSourceQuery())
	}
	if !strings.Contains(kingbaseRoutineSourceQuery(), "LIMIT 20") {
		t.Fatalf("routine source query must bound overload results: %s", kingbaseRoutineSourceQuery())
	}
}

func TestKingbaseTableSourceQueriesUseOneCatalogFamilyAndBoundScope(t *testing.T) {
	for _, catalog := range []string{"pg_catalog.pg", "sys_catalog.sys"} {
		for _, query := range []string{
			kingbaseTableColumnsQuery(catalog),
			kingbaseTableConstraintDefinitionsQuery(catalog),
			kingbaseTableIndexDefinitionsQuery(catalog),
			kingbaseTableTriggerDefinitionsQuery(catalog),
		} {
			if !strings.Contains(query, "$1") || !strings.Contains(query, "$2") || strings.Contains(query, "%s") {
				t.Fatalf("table source query must bind schema and table: %s", query)
			}
		}
	}
	if got, want := kingbaseCatalogDeparser("pg_catalog.pg", "get_expr"), "pg_catalog.pg_get_expr"; got != want {
		t.Fatalf("PostgreSQL deparser = %q, want %q", got, want)
	}
	if got, want := kingbaseCatalogDeparser("sys_catalog.sys", "get_expr"), "sys_catalog.sys_get_expr"; got != want {
		t.Fatalf("Kingbase deparser = %q, want %q", got, want)
	}
}

func TestKingbaseTableDDLHelpersKeepIdentityAndTerminators(t *testing.T) {
	if got, want := kingbaseIdentityClause("a"), "GENERATED ALWAYS AS IDENTITY"; got != want {
		t.Fatalf("identity clause = %q, want %q", got, want)
	}
	if got, want := kingbaseIdentityClause("d"), "GENERATED BY DEFAULT AS IDENTITY"; got != want {
		t.Fatalf("identity clause = %q, want %q", got, want)
	}
	if got := kingbaseIdentityClause(" "); got != "" {
		t.Fatalf("unknown identity clause = %q", got)
	}
	if got, want := kingbaseEnsureStatement("CREATE INDEX idx ON t (id)"), "CREATE INDEX idx ON t (id);"; got != want {
		t.Fatalf("terminated statement = %q, want %q", got, want)
	}
}

func TestKingbaseTypeSourceEscapesCatalogNamesAndLabels(t *testing.T) {
	if got, want := kingbaseQuoteIdentifier(`kind"name`), `"kind""name"`; got != want {
		t.Fatalf("quoted identifier = %q, want %q", got, want)
	}
	if got, want := kingbaseQuoteLiteral(`owner's`), `'owner''s'`; got != want {
		t.Fatalf("quoted enum label = %q, want %q", got, want)
	}
}

func TestKingbaseReferencingForeignKeyQueryUsesBoundTarget(t *testing.T) {
	query := kingbaseReferencingForeignKeysQuery()
	if !strings.Contains(query, "pk.table_schema = $1 AND pk.table_name = $2") {
		t.Fatalf("referencing foreign-key query must bind the target: %s", query)
	}
}

func TestKingbaseColumnQueryBindsTheRelationAndUsesCatalogKeys(t *testing.T) {
	query := kingbaseColumnsQuery()
	if !strings.Contains(query, "c.table_schema = $1 AND c.table_name = $2") || !strings.Contains(query, "tc.constraint_type = 'PRIMARY KEY'") {
		t.Fatalf("column query must expose bound primary-key metadata: %s", query)
	}
}

func TestCancelOnlySignalsTheMatchingKingbaseQuery(t *testing.T) {
	canceled := false
	a := &agent{connections: map[string]*sql.DB{}, active: map[string]context.CancelFunc{}}
	a.setActive("connection", "active", func() { canceled = true })
	if a.cancelActive("connection", "missing") || canceled {
		t.Fatal("unregistered query must not be canceled")
	}
	if !a.cancelActive("connection", "active") || !canceled {
		t.Fatal("active query was not canceled")
	}
}
