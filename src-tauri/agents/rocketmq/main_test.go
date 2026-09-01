package main

import (
	"reflect"
	"testing"
	"time"
)

func TestNormalizeNameServersRejectsURLsAndDeduplicates(t *testing.T) {
	servers, err := normalizeNameServers("127.0.0.1:9876; [2001:db8::1]:9876,127.0.0.1:9876")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"127.0.0.1:9876", "[2001:db8::1]:9876"}
	if !reflect.DeepEqual(servers, want) {
		t.Fatalf("servers = %#v, want %#v", servers, want)
	}
	for _, invalid := range []string{"http://localhost:9876", "localhost", "2001:db8::1:9876", "localhost:0"} {
		if _, err := normalizeNameServers(invalid); err == nil {
			t.Fatalf("expected %q to fail", invalid)
		}
	}
}

func TestParseConnectionUsesNestedAliasesAndTimeout(t *testing.T) {
	config, err := parseConnection(map[string]any{"connection": map[string]any{"namesrvAddr": "broker.example:9876", "connectTimeoutMs": float64(1250)}})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(config.NameServers, []string{"broker.example:9876"}) || config.Timeout != 1250*time.Millisecond {
		t.Fatalf("config = %#v", config)
	}
}

func TestParseConnectionBindsAclCredentialsTogether(t *testing.T) {
	_, err := parseConnection(map[string]any{"namesrvAddr": "broker.example:9876", "accessKey": "access"})
	if err == nil {
		t.Fatal("expected incomplete ACL credentials to fail")
	}
	config, err := parseConnection(map[string]any{"namesrvAddr": "broker.example:9876", "accessKey": "access", "secretKey": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	if config.AccessKey != "access" || config.SecretKey != "secret" {
		t.Fatalf("config = %#v", config)
	}
}

func TestHandshakeDoesNotRequireACluster(t *testing.T) {
	result, err := (&rocketMQAgent{}).dispatch("handshake", nil)
	if err != nil {
		t.Fatal(err)
	}
	value := result.(map[string]any)
	if value["protocolVersion"] != 1 {
		t.Fatalf("unexpected handshake: %#v", value)
	}
}
