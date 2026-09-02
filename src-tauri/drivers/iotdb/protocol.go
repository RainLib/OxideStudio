package iotdb

import "encoding/json"

const ProtocolVersion = "1.0"

type RequestEnvelope struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type ResponseEnvelope struct {
	ID     uint64 `json:"id"`
	Status string `json:"status"`
	Result any    `json:"result,omitempty"`
}

type ProtocolError struct {
	Code      string            `json:"code"`
	Message   string            `json:"message"`
	Retryable bool              `json:"retryable"`
	Details   map[string]string `json:"details"`
}

func Handshake() map[string]any {
	return map[string]any{
		"kind": "handshake",
		"value": map[string]any{
			"protocolVersion": ProtocolVersion, "packageId": "oxide.iotdb", "packageVersion": "0.1.0", "driverId": "iotdb",
			"capabilities": map[string]any{
				"metadata": true, "query": true, "queryPaging": true, "cancellation": true, "transactions": false,
				"databaseScopedQueries": true, "databaseCreation": false, "referencingForeignKeys": false,
				// IoTDB exposes devices and tables through the relation catalog. It
				// does not currently expose independent descriptor objects (such as
				// types or sequences), so do not advertise schemaObjects merely
				// because objectSource can render relation DDL.
				"schemaObjects": false, "readOnlyEnforcement": true, "semanticSchemaMigration": false,
			},
		},
	}
}

func Fail(code, message string) *ProtocolError {
	return &ProtocolError{Code: code, Message: message, Details: map[string]string{}}
}
