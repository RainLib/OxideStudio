package main

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/rainlib/oxide-driver-iotdb"
)

type sidecar struct {
	mu       sync.Mutex
	sessions map[string]*sessionState
}

// sessionState serializes a native IoTDB session. The Go client owns one
// socket-backed session, so concurrent statements must not interleave. Active
// cancel functions remain reachable without taking the execution lock.
type sessionState struct {
	mu       sync.Mutex
	activeMu sync.Mutex
	session  *iotdb.Session
	active   map[string]context.CancelFunc
}

func main() {
	server := &sidecar{sessions: map[string]*sessionState{}}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	var encoderMu sync.Mutex
	var requests sync.WaitGroup
	for scanner.Scan() {
		var request iotdb.RequestEnvelope
		if err := json.Unmarshal(scanner.Bytes(), &request); err != nil {
			encoderMu.Lock()
			_ = encoder.Encode(iotdb.ResponseEnvelope{Status: "error", Result: iotdb.Fail("INVALID_REQUEST", err.Error())})
			encoderMu.Unlock()
			continue
		}
		if request.Method == "shutdown" {
			requests.Wait()
			result, failure := server.dispatch(request)
			encoderMu.Lock()
			if failure != nil {
				_ = encoder.Encode(iotdb.ResponseEnvelope{ID: request.ID, Status: "error", Result: failure})
			} else {
				_ = encoder.Encode(iotdb.ResponseEnvelope{ID: request.ID, Status: "ok", Result: result})
			}
			encoderMu.Unlock()
			return
		}
		requests.Add(1)
		go func(request iotdb.RequestEnvelope) {
			defer requests.Done()
			result, failure := server.dispatch(request)
			encoderMu.Lock()
			defer encoderMu.Unlock()
			if failure != nil {
				_ = encoder.Encode(iotdb.ResponseEnvelope{ID: request.ID, Status: "error", Result: failure})
				return
			}
			_ = encoder.Encode(iotdb.ResponseEnvelope{ID: request.ID, Status: "ok", Result: result})
		}(request)
	}
	requests.Wait()
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
		state := &sessionState{session: session, active: map[string]context.CancelFunc{}}
		s.mu.Lock()
		previous := s.sessions[value.ConnectionID]
		s.sessions[value.ConnectionID] = state
		s.mu.Unlock()
		if previous != nil {
			previous.close()
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
	case "cancel":
		return s.cancel(request.Params)
	case "shutdown":
		s.closeAll()
		return map[string]any{"kind": "empty"}, nil
	default:
		return nil, iotdb.Fail("UNSUPPORTED", "IoTDB package does not support "+request.Method)
	}
}
func (s *sidecar) session(id string) (*sessionState, *iotdb.ProtocolError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.sessions[id]
	if state == nil {
		return nil, iotdb.Fail("CONNECTION_NOT_FOUND", "Connection is not open")
	}
	return state, nil
}
func (s *sidecar) disconnect(id string) {
	s.mu.Lock()
	state := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()
	if state != nil {
		state.close()
	}
}
func (s *sidecar) closeAll() {
	s.mu.Lock()
	sessions := s.sessions
	s.sessions = map[string]*sessionState{}
	s.mu.Unlock()
	for _, state := range sessions {
		state.close()
	}
}
func (s *sidecar) ping(raw json.RawMessage) (any, *iotdb.ProtocolError) {
	var value struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	state, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.session == nil {
		return nil, iotdb.Fail("CONNECTION_NOT_FOUND", "Connection is closed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	data, err := state.session.Execute(ctx, "SHOW VERSION")
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
		QueryID      string            `json:"query_id"`
		Context      struct {
			Database string `json:"database"`
			ReadOnly bool   `json:"read_only"`
		} `json:"context"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	if len(value.Parameters) != 0 {
		return nil, iotdb.Fail("PARAMETERS_UNSUPPORTED", "IoTDB native package does not support bound query parameters")
	}
	state, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.session == nil {
		return nil, iotdb.Fail("CONNECTION_NOT_FOUND", "Connection is closed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	queryID := value.QueryID
	if queryID == "" {
		queryID = "__default__"
	}
	state.setActive(queryID, cancel)
	defer state.clearActive(queryID, cancel)
	if value.Context.ReadOnly && !iotdb.IsReadOnlyStatement(value.Statement) {
		return nil, iotdb.Fail("READ_ONLY_REJECTED", "Read-only query required")
	}
	if err := state.session.UseDatabase(ctx, value.Context.Database); err != nil {
		return nil, iotdb.Fail("QUERY_FAILED", err.Error())
	}
	if !iotdb.IsQueryStatement(value.Statement) {
		err := state.session.ExecuteNonQuery(ctx, value.Statement)
		if ctx.Err() != nil {
			s.invalidate(value.ConnectionID, state)
		}
		if err != nil {
			return nil, iotdb.Fail("QUERY_FAILED", err.Error())
		}
		return map[string]any{"kind": "query", "value": []any{map[string]any{"columns": []any{}, "rows": []any{}, "rowsAffected": uint64(0), "statementType": statementType(value.Statement)}}}, nil
	}
	result, err := state.session.Query(ctx, value.Statement, iotdb.MaxQueryRows, state.session.TimestampPrecision())
	if ctx.Err() != nil {
		s.invalidate(value.ConnectionID, state)
	}
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
	state, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.session == nil {
		return nil, iotdb.Fail("CONNECTION_NOT_FOUND", "Connection is closed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	result, err := state.session.Query(ctx, "SHOW VERSION", 1, state.session.TimestampPrecision())
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
			Kind       string `json:"kind"`
			Namespace  string `json:"namespace"`
			Relation   string `json:"relation"`
			ObjectName string `json:"object_name"`
			ObjectType string `json:"object_type"`
		} `json:"request"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	state, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.session == nil {
		return nil, iotdb.Fail("CONNECTION_NOT_FOUND", "Connection is closed")
	}
	if value.Request.Kind == "objectSource" {
		object := strings.TrimSpace(value.Request.ObjectName)
		if object == "" {
			return nil, iotdb.Fail("METADATA_FAILED", "IoTDB object name is required")
		}
		schema := strings.TrimSpace(value.Request.Namespace)
		if schema == "" {
			return nil, iotdb.Fail("METADATA_FAILED", "IoTDB schema is required")
		}
		statement, err := iotdb.MetadataStatement(state.session.Dialect(), "columns", schema, object)
		if err != nil {
			return nil, iotdb.Fail("METADATA_FAILED", err.Error())
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		columns, err := state.session.Query(ctx, statement, iotdb.MaxQueryRows, state.session.TimestampPrecision())
		if err != nil {
			return nil, iotdb.Fail("METADATA_FAILED", err.Error())
		}
		details := iotdb.QueryResult{}
		aligned := false
		if state.session.Dialect() == iotdb.TableDialect {
			details, err = state.session.Query(ctx, "SHOW TABLES DETAILS FROM "+iotdb.QuoteIdentifier(schema), iotdb.MaxQueryRows, state.session.TimestampPrecision())
		} else {
			var devices iotdb.QueryResult
			devices, err = state.session.Query(ctx, "SHOW DEVICES "+iotdb.TreeDevicePath(schema, object), 1, state.session.TimestampPrecision())
			if err == nil && len(devices.Rows) > 0 {
				aligned = iotdb.MetadataRowBool(devices, devices.Rows[0], "IsAligned")
			}
		}
		if err != nil {
			return nil, iotdb.Fail("METADATA_FAILED", err.Error())
		}
		source, err := iotdb.ObjectSource(state.session.Dialect(), schema, object, columns, details, aligned)
		if err != nil {
			return nil, iotdb.Fail("METADATA_FAILED", err.Error())
		}
		if source == "" {
			return map[string]any{"kind": "metadata", "value": []any{}}, nil
		}
		return map[string]any{"kind": "metadata", "value": []string{source}}, nil
	}
	statement, err := iotdb.MetadataStatement(state.session.Dialect(), value.Request.Kind, value.Request.Namespace, value.Request.Relation)
	if err != nil {
		return nil, iotdb.Fail("METADATA_FAILED", err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := state.session.Query(ctx, statement, iotdb.MaxQueryRows, state.session.TimestampPrecision())
	if err != nil {
		return nil, iotdb.Fail("METADATA_FAILED", err.Error())
	}
	metadata, err := iotdb.AdaptMetadata(value.Request.Kind, value.Request.Namespace, value.Request.Relation, result)
	if err != nil {
		return nil, iotdb.Fail("METADATA_FAILED", err.Error())
	}
	return map[string]any{"kind": "metadata", "value": metadata}, nil
}

func (s *sidecar) cancel(raw json.RawMessage) (any, *iotdb.ProtocolError) {
	var value struct {
		ConnectionID string `json:"connection_id"`
		QueryID      string `json:"query_id"`
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, iotdb.Fail("INVALID_REQUEST", err.Error())
	}
	state, failure := s.session(value.ConnectionID)
	if failure != nil {
		return nil, failure
	}
	return map[string]any{"kind": "boolean", "value": state.cancel(value.QueryID)}, nil
}

func (s *sidecar) invalidate(id string, expected *sessionState) {
	s.mu.Lock()
	if s.sessions[id] == expected {
		delete(s.sessions, id)
	}
	s.mu.Unlock()
	// The active request holds the execution mutex while it unwinds from its
	// canceled context. Close only after that lock becomes available so a
	// canceled call cannot deadlock against its own cleanup.
	go expected.close()
}

func (s *sessionState) setActive(queryID string, cancel context.CancelFunc) {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if s.active == nil {
		s.active = map[string]context.CancelFunc{}
	}
	s.active[queryID] = cancel
}

func (s *sessionState) clearActive(queryID string, cancel context.CancelFunc) {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if s.active[queryID] == nil {
		return
	}
	delete(s.active, queryID)
	cancel()
}

func (s *sessionState) cancel(queryID string) bool {
	s.activeMu.Lock()
	defer s.activeMu.Unlock()
	if queryID == "" {
		queryID = "__default__"
	}
	if cancel := s.active[queryID]; cancel != nil {
		cancel()
		return true
	}
	return false
}

func (s *sessionState) close() {
	s.activeMu.Lock()
	for _, cancel := range s.active {
		cancel()
	}
	s.active = map[string]context.CancelFunc{}
	s.activeMu.Unlock()
	s.mu.Lock()
	if s.session != nil {
		_ = s.session.Close()
		s.session = nil
	}
	s.mu.Unlock()
}

func statementType(statement string) string {
	fields := strings.Fields(strings.TrimSpace(statement))
	if len(fields) == 0 {
		return "UNKNOWN"
	}
	return strings.ToUpper(fields[0])
}
