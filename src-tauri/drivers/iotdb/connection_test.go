package iotdb

import "testing"

func TestParseConnectionConfigSupportsTableClusterTLS(t *testing.T) {
	config, err := ParseConnectionConfig("jdbc:iotdb://alice:secret@db.example:6668/metrics?dialect=table&node_urls=a:6667,b:6667&ssl=true&ssl_ca=C:/certs/ca.pem&rpc_compression=true", map[string]string{"fetch_size": "2048", "time_zone": "UTC", "connect_retry_max": "5", "connect_timeout_ms": "12000"})
	if err != nil {
		t.Fatal(err)
	}
	if config.Host != "db.example" || config.Port != 6668 || config.Username != "alice" || config.Password != "secret" || config.Database != "metrics" {
		t.Fatalf("unexpected config: %#v", config)
	}
	if config.Dialect != TableDialect || !config.TLS || config.TLSCAFile != "C:/certs/ca.pem" || !config.EnableCompression || config.ConnectRetryMax != 5 || config.ConnectTimeoutMS != 12000 || config.FetchSize != 2048 || config.TimeZone != "UTC" || len(config.Nodes) != 2 {
		t.Fatalf("unexpected options: %#v", config)
	}
}

func TestParseConnectionConfigRejectsUnsafeDialectAndPort(t *testing.T) {
	if _, err := ParseConnectionConfig("iotdb://host:0", nil); err == nil {
		t.Fatal("expected port rejection")
	}
	if _, err := ParseConnectionConfig("iotdb://host:6667?dialect=postgres", nil); err == nil {
		t.Fatal("expected dialect rejection")
	}
	if _, err := ParseConnectionConfig("iotdb://host:6667?node_urls=bad-node", nil); err == nil {
		t.Fatal("expected node URL rejection")
	}
	if _, err := ParseConnectionConfig("iotdb://host:6667?ssl_cert=client.pem", nil); err == nil {
		t.Fatal("expected incomplete TLS client credential rejection")
	}
}
