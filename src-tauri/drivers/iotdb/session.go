package iotdb

import (
	"context"
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
	client *client.Session
	config ConnectionConfig
}

func OpenSession(config ConnectionConfig) (*Session, error) {
	if len(config.Nodes) != 1 {
		return nil, fmt.Errorf("IoTDB cluster session routing is not enabled yet")
	}
	clientSession := client.NewSession(&client.Config{
		Host: config.Host, Port: strconv.Itoa(config.Port), UserName: config.Username,
		Password: config.Password, FetchSize: int32(config.FetchSize), TimeZone: config.TimeZone,
	})
	if err := clientSession.Open(false, 15_000); err != nil {
		return nil, err
	}
	session := &Session{client: &clientSession, config: config}
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
	return session, nil
}

func (s *Session) Execute(ctx context.Context, statement string) (*client.SessionDataSet, error) {
	if s == nil || s.client == nil {
		return nil, fmt.Errorf("IoTDB session is closed")
	}
	return s.client.ExecuteStatementWithContext(ctx, statement)
}

func (s *Session) Close() error {
	if s == nil || s.client == nil {
		return nil
	}
	client := s.client
	s.client = nil
	return client.Close()
}
func quote(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }
