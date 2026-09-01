package iotdb

import "testing"

func TestTableDialectIdentifierQuoteEscapesEmbeddedQuotes(t *testing.T) {
	if got, want := quote(`metrics"archive`), `"metrics""archive"`; got != want {
		t.Fatalf("quote = %q, want %q", got, want)
	}
}

func TestNormalizeTimestampPrecisionRejectsUnknownValues(t *testing.T) {
	for _, precision := range []string{"ms", "us", "ns"} {
		actual, err := normalizeTimestampPrecision(precision)
		if err != nil || actual != precision {
			t.Fatalf("precision %q = %q, %v", precision, actual, err)
		}
	}
	if _, err := normalizeTimestampPrecision("seconds"); err == nil {
		t.Fatal("expected unknown precision rejection")
	}
}
