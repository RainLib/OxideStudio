package iotdb

import (
	"encoding/json"
	"testing"
)

func TestIoTDBHandshakeUsesTheExternalDriverProtocolShape(t *testing.T) {
	encoded, err := json.Marshal(ResponseEnvelope{ID: 7, Status: "ok", Result: Handshake()})
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(encoded, &value); err != nil {
		t.Fatal(err)
	}
	if value["id"].(float64) != 7 || value["status"] != "ok" {
		t.Fatalf("envelope = %#v", value)
	}
	result := value["result"].(map[string]any)
	handshake := result["value"].(map[string]any)
	if handshake["driverId"] != "iotdb" || handshake["protocolVersion"] != ProtocolVersion {
		t.Fatalf("handshake = %#v", handshake)
	}
}

func TestIoTDBHandshakeDoesNotAdvertiseUnsupportedDescriptorObjects(t *testing.T) {
	value, ok := Handshake()["value"].(map[string]any)
	if !ok {
		t.Fatalf("handshake value=%#v", Handshake()["value"])
	}
	capabilities, ok := value["capabilities"].(map[string]any)
	if !ok || capabilities["schemaObjects"] != false {
		t.Fatalf("capabilities=%#v", capabilities)
	}
}
