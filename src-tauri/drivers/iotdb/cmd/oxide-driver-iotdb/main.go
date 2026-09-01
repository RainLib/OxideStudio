package main

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/rainlib/oxide-driver-iotdb"
)

type sidecar struct {
	mu       sync.Mutex
	sessions map[string]*iotdb.Session
}

func main() {
	server := &sidecar{sessions: map[string]*iotdb.Session{}}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request iotdb.RequestEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			_ = encoder.Encode(iotdb.ResponseEnvelope{Status: "error", Result: iotdb.Fail("INVALID_REQUEST", err.Error())})
			continue
		}
		result, failure := server.dispatch(request)
		if failure != nil {
			_ = encoder.Encode(iotdb.ResponseEnvelope{ID: request.ID, Status: "error", Result: failure})
			continue
		}
		if err := encoder.Encode(iotdb.ResponseEnvelope{ID: request.ID, Status: "ok", Result: result}); err != nil {
			break
		}
	}
	server.closeAll()
}

func (s *sidecar) dispatch(request iotdb.RequestEnvelope) (any, *iotdb.ProtocolError) {
	switch request.Method {
	case "handshake":
		return iotdb.Handshake(), nil
	case "connect":
		var value struct {
			ConnectionID string `json:"connection_id"`
			Config       struct {
				URL     string            `json:"url"`
				Options map[string]string `json:"options"`
			} `json:"config"`
		}
		if err := json.Unmarshal(request.Params, &value); err != nil {
			return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
		}
		config, err := iotdb.ParseConnectionConfig(value.Config.URL, value.Config.Options)
		if err != nil {
			return nil, iotdb.Fail("INVALID_URL", err.Error())
		}
		session, err := iotdb.OpenSession(config)
		if err != nil {
			return nil, iotdb.Fail("CONNECT_FAILED", err.Error())
		}
		s.mu.Lock()
		previous := s.sessions[value.ConnectionID]
		s.sessions[value.ConnectionID] = session
		s.mu.Unlock()
		if previous != nil {
			_ = previous.Close()
		}
		return map[string]any{"kind": "empty"}, nil
	case "disconnect":
		var value struct {
			ConnectionID string `json:"connection_id"`
		}
		if err := json.Unmarshal(request.Params, &value); err != nil {
			return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
		}
		s.disconnect(value.ConnectionID)
		return map[string]any{"kind": "empty"}, nil
	case "ping":
		return s.ping(request.Params)
	case "serverVersion":
		return s.serverVersion(request.Params)
	case "query":
		return s.query(request.Params)
	case "metadata":
		return s.metadata(request.Params)
	case "shutdown":
		s.closeAll()
		return map[string]any{"kind": "empty"}, nil
	default:
		return nil, iotdb.Fail("UNSUPPORTED", "IoTDB package does not support "+request.Method)
	}
}
func (s *sidecar) session(id string) (*iotdb.Session, *iotdb.ProtocolError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := s.sessions[id]
	if session == nil {
		return nil, iotdb.Fail("CONNECTION_NOT_FOUND", "Connection is not open")
	}
	return session, nil
}
func (s *sidecar) disconnect(id string) {
	s.mu.Lock()
	session := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()
	if session != nil {
		_ = session.Close()
	}
}
func (s *sidecar) closeAll() {
	s.mu.Lock()
	sessions := s.sessions
	s.sessions = map[string]*iotdb.Session{}
	s.mu.Unlock()
	for _, session := range sessions {
		_ = session.Close()
	}
}
func (s *sidecar) ping(raw json.RawMessage) (any, *iotdb.ProtocolError) {
	var value struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	session, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	data, err := session.Execute(ctx, "SHOW VERSION")
	if data != nil {
		_ = data.Close()
	}
	if err != nil {
		return nil, iotdb.Fail("PING_FAILED", err.Error())
	}
	return map[string]any{"kind": "boolean", "value": true}, nil
}
func (s *sidecar) query(raw json.RawMessage) (any, *iotdb.ProtocolError) {
	var value struct {
		ConnectionID string            `json:"connection_id"`
		Statement    string            `json:"statement"`
		Parameters   []json.RawMessage `json:"parameters"`
		Context      struct {
			Database string `json:"database"`
		} `json:"context"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	if len(value.Parameters) != 0 {
		return nil, iotdb.Fail("PARAMETERS_UNSUPPORTED", "IoTDB native package does not support bound query parameters")
	}
	session, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := session.Query(ctx, value.Statement, iotdb.MaxQueryRows, session.TimestampPrecision())
	if err != nil {
		return nil, iotdb.Fail("QUERY_FAILED", err.Error())
	}
	return map[string]any{"kind": "query", "value": []any{map[string]any{"columns": protocolColumns(result), "rows": result.Rows, "truncated": result.Truncated, "rowLimit": iotdb.MaxQueryRows, "rowsAffected": result.RowsAffected}}}, nil
}

func (s *sidecar) serverVersion(raw json.RawMessage) (any, *iotdb.ProtocolError) {
	var value struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	session, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := session.Query(ctx, "SHOW VERSION", 1, session.TimestampPrecision())
	if err != nil {
		return nil, iotdb.Fail("VERSION_FAILED", err.Error())
	}
	var version any
	if len(result.Rows) > 0 && len(result.Rows[0]) > 0 {
		version = result.Rows[0][0]
	}
	return map[string]any{"kind": "serverVersion", "value": version}, nil
}

func protocolColumns(result iotdb.QueryResult) []map[string]string {
	columns := make([]map[string]string, len(result.Columns))
	for index, name := range result.Columns {
		dataType := "UNKNOWN"
		if index < len(result.ColumnTypes) {
			dataType = result.ColumnTypes[index]
		}
		columns[index] = map[string]string{"name": name, "dataType": dataType}
	}
	return columns
}
func (s *sidecar) metadata(raw json.RawMessage) (any, *iotdb.ProtocolError) {
	var value struct {
		ConnectionID string `json:"connection_id"`
		Request      struct {
			Kind      string `json:"kind"`
			Namespace string `json:"namespace"`
			Relation  string `json:"relation"`
		} `json:"request"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	session, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	statement, err := iotdb.MetadataStatement(session.Dialect(), value.Request.Kind, value.Request.Namespace, value.Request.Relation)
	if err != nil {
		return nil, iotdb.Fail("METADATA_FAILED", err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := session.Query(ctx, statement, iotdb.MaxQueryRows, session.TimestampPrecision())
	if err != nil {
		return nil, iotdb.Fail("METADATA_FAILED", err.Error())
	}
	metadata, err := iotdb.AdaptMetadata(value.Request.Kind, value.Request.Namespace, result)
	if err != nil {
		return nil, iotdb.Fail("METADATA_FAILED", err.Error())
	}
	return map[string]any{"kind": "metadata", "value": metadata}, nil
}
