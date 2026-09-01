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
	client *client.Session
	config ConnectionConfig
}

func OpenSession(config ConnectionConfig) (*Session, error) {
	tlsConfig := (*client.TLSConfig)(nil)
	if config.TLS {
		tlsConfig = &client.TLSConfig{
			Config:   &tls.Config{InsecureSkipVerify: config.InsecureSkipVerify}, // #nosec G402 -- explicit per-connection opt-in
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
		err = clientSession.Open(config.EnableCompression, 15_000)
	}
	if err != nil {
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

func (s *Session) Dialect() string {
	if s == nil {
		return TreeDialect
	}
	return s.config.Dialect
}
func quote(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }
