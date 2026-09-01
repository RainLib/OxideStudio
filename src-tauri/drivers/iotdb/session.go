package iotdb

import (
	"context"
	"crypto/tls"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/apache/iotdb-client-go/v2/client"
)

// Session owns the native client lifecycle for one Sidecar connection. It is
// deliberately not constructed from UI fields: ParseConnectionConfig has
// already validated and normalized the opaque signed-package URL.
type Session struct {
	client             *client.Session
	config             ConnectionConfig
	timestampPrecision string
}

func OpenSession(config ConnectionConfig) (*Session, error) {
	tlsConfig := (*client.TLSConfig)(nil)
	if config.TLS {
		tlsConfig = &client.TLSConfig{
			Config:   &tls.Config{ServerName: config.Host, MinVersion: tls.VersionTLS12, InsecureSkipVerify: config.InsecureSkipVerify}, // #nosec G402 -- explicit per-connection opt-in
			CAFile:   config.TLSCAFile,
			CertFile: config.TLSCertFile,
			KeyFile:  config.TLSKeyFile,
		}
	}
	var clientSession client.Session
	var err error
	if len(config.Nodes) > 1 {
		clientSession, err = client.NewClusterSession(&client.ClusterConfig{
			NodeUrls: config.Nodes, UserName: config.Username, Password: config.Password,
			FetchSize: int32(config.FetchSize), TimeZone: config.TimeZone,
			ConnectRetryMax: config.ConnectRetryMax, TLSConfig: tlsConfig,
		})
		if err == nil {
			err = clientSession.OpenCluster(config.EnableCompression)
		}
	} else {
		clientSession = client.NewSession(&client.Config{
			Host: config.Host, Port: strconv.Itoa(config.Port), UserName: config.Username,
			Password: config.Password, FetchSize: int32(config.FetchSize), TimeZone: config.TimeZone,
			ConnectRetryMax: config.ConnectRetryMax, TLSConfig: tlsConfig,
		})
		err = clientSession.Open(config.EnableCompression, config.ConnectTimeoutMS)
	}
	if err != nil {
		return nil, err
	}
	session := &Session{client: &clientSession, config: config, timestampPrecision: "ms"}
	if config.Dialect == TableDialect {
		context, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		data, err := session.client.ExecuteStatementWithContext(context, "SET SQL_DIALECT=TABLE")
		if err == nil && data != nil {
			_ = data.Close()
		}
		if err != nil {
			_ = session.Close()
			return nil, err
		}
		if config.Database != "" {
			data, err = session.client.ExecuteStatementWithContext(context, "USE "+quote(config.Database))
			if err == nil && data != nil {
				_ = data.Close()
			}
			if err != nil {
				_ = session.Close()
				return nil, err
			}
		}
	}
	precisionContext, cancel := context.WithTimeout(context.Background(), minDuration(time.Duration(config.ConnectTimeoutMS)*time.Millisecond, 5*time.Second))
	if precision, err := session.readTimestampPrecision(precisionContext); err == nil {
		session.timestampPrecision = precision
	}
	cancel()
	return session, nil
}

func (s *Session) Execute(ctx context.Context, statement string) (*client.SessionDataSet, error) {
	if s == nil || s.client == nil {
		return nil, fmt.Errorf("IoTDB session is closed")
	}
	return executeStatement(ctx, s.client, statement)
}

// ExecuteNonQuery runs one IoTDB native mutation or DDL statement. The caller
// owns the policy decision; this package only keeps the client lifecycle and
// result cursor boundary inside the sidecar.
func (s *Session) ExecuteNonQuery(ctx context.Context, statement string) error {
	data, err := s.Execute(ctx, statement)
	if data != nil {
		closeErr := data.Close()
		if err == nil {
			err = closeErr
		}
	}
	return err
}

// UseDatabase applies a Table-dialect database context before a statement.
// Tree dialect paths are fully qualified and therefore have no equivalent
// session-level database selection.
func (s *Session) UseDatabase(ctx context.Context, database string) error {
	if s == nil || s.client == nil || s.config.Dialect != TableDialect {
		return nil
	}
	database = strings.TrimSpace(database)
	if database == "" {
		return nil
	}
	return s.ExecuteNonQuery(ctx, "USE "+quote(database))
}

func (s *Session) Close() error {
	if s == nil || s.client == nil {
		return nil
	}
	client := s.client
	s.client = nil
	return client.Close()
}

func (s *Session) Dialect() string {
	if s == nil {
		return TreeDialect
	}
	return s.config.Dialect
}

func (s *Session) TimestampPrecision() string {
	if s == nil || s.timestampPrecision == "" {
		return "ms"
	}
	return s.timestampPrecision
}

func (s *Session) readTimestampPrecision(ctx context.Context) (string, error) {
	data, err := s.Execute(ctx, "SHOW VARIABLES")
	if err != nil {
		return "", err
	}
	defer data.Close()
	columns := data.GetColumnNames()
	variableIndex, valueIndex := int32(1), int32(2)
	for index, column := range columns {
		switch strings.ToLower(strings.TrimSpace(column)) {
		case "variable":
			variableIndex = int32(index + 1)
		case "value":
			valueIndex = int32(index + 1)
		}
	}
	for {
		hasNext, err := data.Next()
		if err != nil {
			return "", err
		}
		if !hasNext {
			return "", fmt.Errorf("IoTDB timestamp precision was not reported")
		}
		variable, err := data.GetStringByIndex(variableIndex)
		if err != nil {
			return "", err
		}
		if !strings.EqualFold(strings.ReplaceAll(strings.TrimSpace(variable), "_", ""), "TimestampPrecision") {
			continue
		}
		value, err := data.GetStringByIndex(valueIndex)
		if err != nil {
			return "", err
		}
		return normalizeTimestampPrecision(value)
	}
}

func executeStatement(ctx context.Context, session *client.Session, statement string) (data *client.SessionDataSet, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				err = ctxErr
			} else {
				err = fmt.Errorf("IoTDB Go client panicked while executing statement: %v", recovered)
			}
			data = nil
		}
	}()
	return session.ExecuteStatementWithContext(ctx, statement)
}

func normalizeTimestampPrecision(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "ms", "us", "ns":
		return strings.ToLower(strings.TrimSpace(value)), nil
	default:
		return "", fmt.Errorf("unsupported IoTDB timestamp precision: %s", value)
	}
}

func minDuration(left, right time.Duration) time.Duration {
	if left < right {
		return left
	}
	return right
}
func quote(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }
