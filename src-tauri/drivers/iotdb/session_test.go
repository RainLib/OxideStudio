package iotdb

import "testing"

func TestTableDialectIdentifierQuoteEscapesEmbeddedQuotes(t *testing.T) {
	if got, want := quote(`metrics"archive`), `"metrics""archive"`; got != want {
		t.Fatalf("quote = %q, want %q", got, want)
	}
}
